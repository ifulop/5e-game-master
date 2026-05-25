import Anthropic from '@anthropic-ai/sdk';
import { existsSync, rmSync } from 'fs';
import { readJSON, readFile } from '../fileUtils.js';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, '../prompts');
const MODEL = process.env.NARRATOR_MODEL ?? 'claude-sonnet-4-6';

function campaignDir() { return process.env.CAMPAIGN_DIR ?? 'campaign'; }

let _systemText = null;
function systemText() {
  _systemText ??= readFile(`${PROMPTS_DIR}/narrator_system.txt`);
  return _systemText;
}

// ── retry ─────────────────────────────────────────────────────────────────────

function isRetriable(err) {
  return err?.status === 429 || err?.status === 529 || err?.status === 500 || err?.code === 'ECONNRESET';
}

async function withRetry(fn, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetriable(err) || attempt === maxAttempts) throw err;
      const jitter = 0.8 + Math.random() * 0.4;
      await new Promise(r => setTimeout(r, Math.round(1000 * 2 ** (attempt - 1) * jitter)));
    }
  }
  throw lastErr;
}

// ── context helpers ───────────────────────────────────────────────────────────

function safeReadFile(path) {
  return existsSync(path) ? readFile(path) : null;
}

function getPlayerIds(dir) {
  const intake = existsSync(`${dir}/intake.json`) ? readJSON(`${dir}/intake.json`) : null;
  return (intake?.party ?? []).map(p => p.name.toLowerCase());
}

function loadPlayerCards(dir, playerIds) {
  return playerIds
    .map(id => safeReadFile(`${dir}/players/${id}/${id}_narrator.md`))
    .filter(Boolean)
    .join('\n\n---\n\n');
}

function loadNPCCards(dir, npcIds) {
  return (npcIds ?? [])
    .map(id => safeReadFile(`${dir}/npcs/${id}/${id}_narrator.md`))
    .filter(Boolean)
    .join('\n\n---\n\n');
}

function formatTurnHistory(inputs) {
  if (!inputs?.length) return '(no turns yet)';
  return inputs.map((inp, i) => `Turn ${i + 1}: ${inp}`).join('\n');
}

function loadEncounterContext(dir, session) {
  const encId = session.current_encounter_id;
  const npcIds = session.current_encounter_npcs ?? [];
  const locationId = session.current_encounter_location_id ?? null;
  const prevEncId = session.prev_encounter_id ?? null;

  const encBrief = safeReadFile(`${dir}/encounters/${encId}.md`) ?? '';
  const npcCards = loadNPCCards(dir, npcIds);
  const locationCard = locationId
    ? safeReadFile(`${dir}/locations/${locationId}/${locationId}_narrator.md`) ?? ''
    : '';
  const prevSummary = prevEncId
    ? safeReadFile(`${dir}/encounters/${prevEncId}_summary.md`) ?? ''
    : '';

  return { encBrief, npcCards, locationCard, prevSummary };
}

// ── system message builder ────────────────────────────────────────────────────
//
// System array layout:
//   [0] narrator instructions + world_primer  — cache_control: ephemeral (static per session)
//   [1] player cards                           — cache_control: ephemeral (static per encounter)
//   [2] dynamic context (NPC/location/history) — no caching (changes per turn)

function buildSystemMessages(worldPrimer, playerCards, dynamicContext) {
  const base = `${systemText()}\n\n---\n\n## World Primer\n\n${worldPrimer}`;
  const system = [
    { type: 'text', text: base, cache_control: { type: 'ephemeral' } },
  ];
  if (playerCards) {
    system.push({ type: 'text', text: `## Player Cards\n\n${playerCards}`, cache_control: { type: 'ephemeral' } });
  }
  if (dynamicContext) {
    system.push({ type: 'text', text: dynamicContext });
  }
  return system;
}

async function callNarrator(system, userMessage, maxTokens = 1024) {
  const client = new Anthropic();
  const response = await withRetry(() =>
    client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userMessage }],
    })
  );
  return response.content[0].text;
}

// ── exports ───────────────────────────────────────────────────────────────────

export async function openScene() {
  const dir = campaignDir();
  const session = readJSON(`${dir}/session.json`);

  const worldPrimer = safeReadFile(`${dir}/world_primer.md`) ?? '';
  const playerIds = getPlayerIds(dir);
  const playerCards = loadPlayerCards(dir, playerIds);
  const { encBrief, npcCards, locationCard, prevSummary } = loadEncounterContext(dir, session);

  // Include resume brief if present (campaign was saved mid-session) — one-time use
  const saveBriefPath = `${dir}/save_brief.md`;
  const saveBrief = safeReadFile(saveBriefPath);

  const parts = [
    npcCards && `## NPC Cards\n\n${npcCards}`,
    locationCard && `## Location\n\n${locationCard}`,
    prevSummary && `## Previous Encounter Summary\n\n${prevSummary}`,
    saveBrief && `## Campaign Resume Brief\n\n${saveBrief}`,
    `## Current Encounter Brief\n\n${encBrief}`,
  ].filter(Boolean);

  const narration = await callNarrator(
    buildSystemMessages(worldPrimer, playerCards, parts.join('\n\n')),
    'Open the scene.'
  );

  // Delete save_brief.md after first use so it doesn't pollute future scene opens
  if (saveBrief && existsSync(saveBriefPath)) rmSync(saveBriefPath);

  return narration;
}

export async function continueTurn(playerInput) {
  const dir = campaignDir();
  const session = readJSON(`${dir}/session.json`);

  const worldPrimer = safeReadFile(`${dir}/world_primer.md`) ?? '';
  const playerIds = getPlayerIds(dir);
  const playerCards = loadPlayerCards(dir, playerIds);
  const { encBrief, npcCards, locationCard, prevSummary } = loadEncounterContext(dir, session);

  // exclude the current input from history — it becomes the user message
  const prevInputs = session.player_inputs.slice(0, -1);
  const turnHistory = formatTurnHistory(prevInputs);

  const parts = [
    npcCards && `## NPC Cards\n\n${npcCards}`,
    locationCard && `## Location\n\n${locationCard}`,
    prevSummary && `## Previous Encounter Summary\n\n${prevSummary}`,
    `## Current Encounter Brief\n\n${encBrief}`,
    `## Previous Turns This Encounter\n\n${turnHistory}`,
  ].filter(Boolean);

  return callNarrator(
    buildSystemMessages(worldPrimer, playerCards, parts.join('\n\n')),
    playerInput
  );
}

export async function closeEncounter(resolverResult) {
  const dir = campaignDir();
  const session = readJSON(`${dir}/session.json`);

  const worldPrimer = safeReadFile(`${dir}/world_primer.md`) ?? '';
  const playerIds = getPlayerIds(dir);
  const playerCards = loadPlayerCards(dir, playerIds);
  const { encBrief, npcCards, locationCard } = loadEncounterContext(dir, session);
  const turnHistory = formatTurnHistory(session.player_inputs);
  const resolutionType = resolverResult.resolution_triggered;

  const parts = [
    npcCards && `## NPC Cards\n\n${npcCards}`,
    locationCard && `## Location\n\n${locationCard}`,
    `## Current Encounter Brief\n\n${encBrief}`,
    `## Turn History This Encounter\n\n${turnHistory}`,
  ].filter(Boolean);

  return callNarrator(
    buildSystemMessages(worldPrimer, playerCards, parts.join('\n\n')),
    `Close the scene. The encounter resolved with outcome: ${resolutionType}.`
  );
}

export async function closeCampaign() {
  const dir = campaignDir();
  const session = readJSON(`${dir}/session.json`);
  const encounterIds = session.encounter_ids ?? [];

  const worldPrimer = safeReadFile(`${dir}/world_primer.md`) ?? '';
  const playerIds = getPlayerIds(dir);
  const playerCards = loadPlayerCards(dir, playerIds);

  const summaries = encounterIds
    .map(encId => safeReadFile(`${dir}/encounters/${encId}_summary.md`))
    .filter(Boolean)
    .join('\n\n---\n\n');

  const parts = [
    summaries && `## Campaign Summaries\n\n${summaries}`,
  ].filter(Boolean);

  return callNarrator(
    buildSystemMessages(worldPrimer, playerCards, parts.join('\n\n')),
    'Deliver the campaign epilogue.',
    2048
  );
}

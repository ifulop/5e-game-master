import Anthropic from '@anthropic-ai/sdk';
import { existsSync } from 'fs';
import { readJSON, writeJSON, readFile, writeFile, appendToFile } from '../fileUtils.js';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, '../prompts');
const MODEL = process.env.PLANNER_MODEL ?? 'claude-sonnet-4-6';

function campaignDir() { return process.env.CAMPAIGN_DIR ?? 'campaign'; }

const _prompts = {};
function systemPrompt(name) {
  _prompts[name] ??= readFile(`${PROMPTS_DIR}/${name}.txt`);
  return _prompts[name];
}

// ── retry ─────────────────────────────────────────────────────────────────────

function isRetriable(err) {
  return err?.status === 429 || err?.status === 529;
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

// ── parsers ───────────────────────────────────────────────────────────────────

function parseFileTags(raw) {
  const results = [];
  const re = /<file path="([^"]+)">([\s\S]*?)<\/file>/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    results.push({ path: m[1], content: m[2].trim() });
  }
  return results;
}

function parseAppendTags(raw) {
  const results = [];
  const re = /<append path="([^"]+)">([\s\S]*?)<\/append>/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    results.push({ path: m[1], content: m[2].trim() });
  }
  return results;
}

function stripFences(raw) {
  return raw.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
}

function safeReadFile(path) {
  return existsSync(path) ? readFile(path) : null;
}

// ── exports ───────────────────────────────────────────────────────────────────

export async function generateCampaign(intakeData) {
  const dir = campaignDir();
  const client = new Anthropic();
  const response = await withRetry(() =>
    client.messages.create({
      model: MODEL,
      max_tokens: 8096,
      system: [{ type: 'text', text: systemPrompt('planner_system'), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `## Party Intake Data\n\n${JSON.stringify(intakeData, null, 2)}` }],
    })
  );

  const raw = response.content[0].text;
  const files = parseFileTags(raw);
  if (files.length === 0) throw new Error('Planner generateCampaign: no <file> tags in response');

  const hasCampaignJson = files.some(f => f.path === 'campaign.json');
  if (!hasCampaignJson) throw new Error('Planner generateCampaign: campaign.json not found in response');

  for (const { path, content } of files) {
    const fullPath = `${dir}/${path}`;
    if (path.endsWith('.json')) {
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (err) {
        throw new Error(`Planner generateCampaign: invalid JSON in ${path}: ${err.message}`);
      }
      writeJSON(fullPath, parsed);
    } else {
      writeFile(fullPath, content);
    }
  }
}

export async function applyRevelations(triggers) {
  const dir = campaignDir();
  const campaign = readJSON(`${dir}/campaign.json`);
  const session = readJSON(`${dir}/session.json`);
  const encId = session.current_encounter_id;
  const encIndex = session.current_encounter_index;
  const currentEnc = campaign.encounters[encIndex];

  const allConditions = [
    ...(currentEnc.revelation_conditions ?? []),
    ...Object.values(campaign.location_secrets ?? {}).flatMap(s => s.revelation_conditions ?? []),
  ];
  const triggeredConditions = allConditions.filter(c => triggers.includes(c.id));
  if (triggeredConditions.length === 0) return;

  const arcBrief = safeReadFile(`${dir}/arc_brief.md`) ?? '';
  const encBrief = safeReadFile(`${dir}/encounters/${encId}.md`) ?? '';

  const userMessage = [
    '## Triggered Revelation Condition(s)',
    JSON.stringify(triggeredConditions, null, 2),
    '',
    '## Current Turn',
    String(session.turn_count),
    '',
    '## Current Encounter Brief',
    encBrief,
    '',
    '## Arc Brief (for context)',
    arcBrief,
  ].join('\n');

  const client = new Anthropic();
  const response = await withRetry(() =>
    client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: [{ type: 'text', text: systemPrompt('planner_revelation'), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
    })
  );

  const raw = response.content[0].text;
  for (const { path, content } of parseAppendTags(raw)) {
    appendToFile(`${dir}/${path}`, `\n\n${content}`);
  }
}

export async function updateNarrativeForStateChanges(changes) {
  if (!changes?.length) return;
  const dir = campaignDir();

  const byLocation = {};
  for (const change of changes) {
    (byLocation[change.location] ??= []).push(change);
  }

  const locationCards = {};
  for (const locId of Object.keys(byLocation)) {
    const cardPath = `${dir}/locations/${locId}/${locId}_narrator.md`;
    locationCards[locId] = safeReadFile(cardPath) ?? '';
  }

  const userMessage = [
    '## Object State Changes Requiring Narrative Prose',
    JSON.stringify(changes, null, 2),
    '',
    '## Current Location Narrator Cards',
    ...Object.entries(locationCards).map(([id, content]) => `### ${id}\n${content}`),
  ].join('\n');

  const systemText = [
    'You are updating location narrator cards with prose descriptions of object state changes.',
    'For each affected location, append a brief factual update describing what changed.',
    '',
    'Use this exact format — no prose outside the tags:',
    '<append path="locations/[location_id]/[location_id]_narrator.md">',
    '## Post-Turn Update',
    '[Factual prose description of the changes. Past tense. 2-3 sentences maximum.]',
    '</append>',
  ].join('\n');

  const client = new Anthropic();
  const response = await withRetry(() =>
    client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: [{ type: 'text', text: systemText }],
      messages: [{ role: 'user', content: userMessage }],
    })
  );

  const raw = response.content[0].text;
  for (const { path, content } of parseAppendTags(raw)) {
    appendToFile(`${dir}/${path}`, `\n\n${content}`);
  }
}

export async function closeEncounter(params) {
  const { encounter_summary, resolver_result } = params;
  const dir = campaignDir();

  const session = readJSON(`${dir}/session.json`);
  const campaign = readJSON(`${dir}/campaign.json`);
  const encId = session.current_encounter_id;
  const encIndex = session.current_encounter_index;
  const currentEnc = campaign.encounters[encIndex];

  const arcBrief = safeReadFile(`${dir}/arc_brief.md`) ?? '';
  const encBrief = safeReadFile(`${dir}/encounters/${encId}.md`) ?? '';

  const npcSections = [];
  for (const npcId of (currentEnc.npcs ?? [])) {
    const narratorCard = safeReadFile(`${dir}/npcs/${npcId}/${npcId}_narrator.md`);
    const hiddenBrief = safeReadFile(`${dir}/npcs/${npcId}/${npcId}_hidden.md`);
    if (narratorCard || hiddenBrief) {
      npcSections.push(
        `### ${npcId}`,
        `**Narrator Card:**\n${narratorCard ?? '(not found)'}`,
        `**Hidden Brief:**\n${hiddenBrief ?? '(not found)'}`,
      );
    }
  }

  const playerSections = [];
  const intake = existsSync(`${dir}/intake.json`) ? readJSON(`${dir}/intake.json`) : null;
  for (const player of (intake?.party ?? [])) {
    const id = player.name.toLowerCase();
    const card = safeReadFile(`${dir}/players/${id}/${id}_narrator.md`);
    if (card) playerSections.push(`### ${id}\n${card}`);
  }

  const userMessage = [
    '## Encounter Summary',
    encounter_summary,
    '',
    '## Resolver Result',
    JSON.stringify(resolver_result, null, 2),
    '',
    '## Arc Brief',
    arcBrief,
    '',
    '## Encounter Brief',
    encBrief,
    ...(npcSections.length > 0 ? ['', '## Active NPC Cards', ...npcSections] : []),
    ...(playerSections.length > 0 ? ['', '## Player Cards', ...playerSections] : []),
  ].join('\n');

  const client = new Anthropic();
  const response = await withRetry(() =>
    client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: [{ type: 'text', text: systemPrompt('planner_reconciliation'), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
    })
  );

  const jsonText = stripFences(response.content[0].text);
  let result;
  try {
    result = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Planner closeEncounter: invalid JSON: ${err.message}\nRaw: ${jsonText.slice(0, 300)}`);
  }

  for (const key of ['npc_updates', 'player_updates', 'location_updates', 'campaign_updates']) {
    if (!(key in result)) throw new Error(`Planner closeEncounter: missing required key "${key}"`);
  }

  return result;
}

export async function openNextEncounter(params) {
  const { completed_summary, next_encounter, campaign_progress } = params;
  const dir = campaignDir();

  const arcBrief = safeReadFile(`${dir}/arc_brief.md`) ?? '';
  const nextEncBrief = safeReadFile(`${dir}/encounters/${next_encounter.id}.md`) ?? '';

  const userMessage = [
    '## Completed Encounter Summary',
    completed_summary,
    '',
    '## Campaign Progress',
    JSON.stringify(campaign_progress, null, 2),
    '',
    '## Next Encounter',
    JSON.stringify(next_encounter, null, 2),
    '',
    '## Next Encounter Brief',
    nextEncBrief,
    '',
    '## Arc Brief',
    arcBrief,
  ].join('\n');

  const client = new Anthropic();
  const response = await withRetry(() =>
    client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: [{ type: 'text', text: systemPrompt('planner_open_encounter'), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
    })
  );

  const jsonText = stripFences(response.content[0].text);
  let result;
  try {
    result = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Planner openNextEncounter: invalid JSON: ${err.message}\nRaw: ${jsonText.slice(0, 300)}`);
  }

  if (!result.outcome) throw new Error('Planner openNextEncounter: missing "outcome" field');
  if (!Array.isArray(result.file_updates)) throw new Error('Planner openNextEncounter: "file_updates" must be an array');

  for (const { path, content } of result.file_updates) {
    const fullPath = `${dir}/${path}`;
    if (path.endsWith('.json')) {
      writeJSON(fullPath, JSON.parse(content));
    } else {
      writeFile(fullPath, content);
    }
  }

  return result;
}

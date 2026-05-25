import 'dotenv/config';
import express from 'express';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';
import { readJSON, writeJSON, readFile, writeFile, appendToFile } from './fileUtils.js';
import * as intake from './agents/intake.js';
import * as narrator from './agents/narrator.js';
import { setupCampaign, processTurn } from './index.js';

const app = express();
app.use(express.json());
app.use(express.static('public'));

const CAMPAIGNS_ROOT = 'campaigns';
const ACTIVE_ID_PATH = `${CAMPAIGNS_ROOT}/active_id`;
const INDEX_PATH = `${CAMPAIGNS_ROOT}/index.json`;

// ── Campaign registry helpers ─────────────────────────────────────────────────

function getActiveCampaignDir() {
  if (!existsSync(ACTIVE_ID_PATH)) return null;
  const id = readFileSync(ACTIVE_ID_PATH, 'utf8').trim();
  return id ? `${CAMPAIGNS_ROOT}/${id}` : null;
}

function setActiveCampaignId(id) {
  if (!existsSync(CAMPAIGNS_ROOT)) mkdirSync(CAMPAIGNS_ROOT, { recursive: true });
  writeFileSync(ACTIVE_ID_PATH, id ?? '', 'utf8');
}

function clearActiveCampaign() {
  writeFileSync(ACTIVE_ID_PATH, '', 'utf8');
}

function loadIndex() {
  return existsSync(INDEX_PATH) ? readJSON(INDEX_PATH) : [];
}

function saveIndex(index) {
  if (!existsSync(CAMPAIGNS_ROOT)) mkdirSync(CAMPAIGNS_ROOT, { recursive: true });
  writeJSON(INDEX_PATH, index);
}

function upsertIndexEntry(entry) {
  const index = loadIndex();
  const i = index.findIndex(e => e.id === entry.id);
  if (i >= 0) index[i] = { ...index[i], ...entry };
  else index.push(entry);
  saveIndex(index);
}

function buildSaveBrief(dir, session, campaign) {
  const intakePath = `${dir}/intake.json`;
  const party = existsSync(intakePath)
    ? readJSON(intakePath).party.map(p => `${p.name} (${p.class})`).join(', ')
    : 'Unknown';

  const enc = campaign.encounters[session.current_encounter_index];
  const completedSummaries = (session.encounter_ids ?? [])
    .slice(0, session.current_encounter_index)
    .map(id => {
      const p = `${dir}/encounters/${id}_summary.md`;
      return existsSync(p) ? `### ${id}\n\n${readFile(p)}` : null;
    })
    .filter(Boolean)
    .join('\n\n');

  const currentBriefPath = `${dir}/encounters/${enc?.id}.md`;
  const currentBrief = enc && existsSync(currentBriefPath) ? readFile(currentBriefPath) : '';

  const recentTurns = (session.player_inputs ?? [])
    .map((inp, i) => `Turn ${i + 1}: ${inp}`)
    .join('\n');

  const transcriptPath = `${dir}/adventure_transcript.md`;
  const recentNarration = existsSync(transcriptPath)
    ? readFile(transcriptPath).slice(-600) : '';

  const lines = [
    `# Campaign Resume Brief`,
    `\n**Campaign:** ${session.save_name ?? session.campaign_id}`,
    `**Saved:** ${new Date().toISOString()}`,
    `**Party:** ${party}`,
    `**Status:** Encounter ${(session.current_encounter_index ?? 0) + 1} of ${campaign.encounters.length} — Turn ${session.turn_count ?? 0}`,
  ];
  if (completedSummaries) lines.push(`\n## Story So Far\n\n${completedSummaries}`);
  if (currentBrief) lines.push(`\n## Current Encounter\n\n${currentBrief}`);
  if (recentTurns) lines.push(`\n## Recent Turns This Encounter\n\n${recentTurns}`);
  if (recentNarration) lines.push(`\n## Where We Left Off\n\n...${recentNarration}`);
  return lines.join('\n');
}

function performSave(dir, name, quit) {
  const sessionPath = `${dir}/session.json`;
  const campaignPath = `${dir}/campaign.json`;
  if (!existsSync(sessionPath) || !existsSync(campaignPath)) return null;

  const session = readJSON(sessionPath);
  const campaign = readJSON(campaignPath);
  const saveName = name ?? session.save_name ?? campaign.meta?.campaign_id ?? 'Campaign';
  const savedAt = new Date().toISOString();

  session.save_name = saveName;
  session.saved_at = savedAt;
  writeJSON(sessionPath, session);

  const brief = buildSaveBrief(dir, session, campaign);
  writeFile(`${dir}/save_brief.md`, brief);

  const enc = campaign.encounters[session.current_encounter_index];
  upsertIndexEntry({
    id: session.campaign_id,
    name: saveName,
    created_at: session.created_at ?? savedAt,
    saved_at: savedAt,
    status: session.encounter_status,
    encounter: session.current_encounter_id,
    encounter_index: session.current_encounter_index,
    total_encounters: campaign.encounters.length,
    party: existsSync(`${dir}/intake.json`)
      ? readJSON(`${dir}/intake.json`).party.map(p => `${p.name} (${p.class})`)
      : [],
    encounter_title: enc?.title ?? null,
  });

  if (quit) clearActiveCampaign();
  return { saved: true, name: saveName, saved_at: savedAt };
}

// ── Middleware: resolve active campaign dir per request ───────────────────────

app.use((req, res, next) => {
  const dir = getActiveCampaignDir();
  if (dir) process.env.CAMPAIGN_DIR = dir;
  next();
});

// ── helpers that use the active campaign dir ──────────────────────────────────

function campaignDir() { return process.env.CAMPAIGN_DIR ?? `${CAMPAIGNS_ROOT}/default`; }

function logTranscript(text) {
  appendToFile(`${campaignDir()}/adventure_transcript.md`, text);
}

function getCurrentPhase() {
  const dir = campaignDir();
  const formPath = `${dir}/intake_form.json`;
  const intakePath = `${dir}/intake.json`;
  const sessionPath = `${dir}/session.json`;

  if (!existsSync(sessionPath)) {
    if (existsSync(formPath) || existsSync(intakePath)) return 'intake';
    return 'no_campaign';
  }
  const session = readJSON(sessionPath);
  if (session.encounter_status === 'complete') return 'complete';
  if (session.encounter_status === 'awaiting_scene_open') return 'awaiting_scene_open';
  return 'in_progress';
}

// ── GET /status ───────────────────────────────────────────────────────────────

app.get('/status', (req, res) => {
  const activeDir = getActiveCampaignDir();
  if (!activeDir) {
    return res.json({ phase: 'no_campaign' });
  }

  const phase = getCurrentPhase();

  if (phase === 'no_campaign') {
    return res.json({ phase: 'no_campaign' });
  }

  if (phase === 'intake') {
    const dir = campaignDir();
    const intakeStep = existsSync(`${dir}/intake_form.json`) ? 'review' : 'form';
    return res.json({ phase: 'intake', intakeStep });
  }

  const session = readJSON(`${campaignDir()}/session.json`);
  const campaignPath = `${campaignDir()}/campaign.json`;
  const campaign = existsSync(campaignPath) ? readJSON(campaignPath) : null;
  const enc = campaign?.encounters[session.current_encounter_index];

  const base = {
    encounter_id: session.current_encounter_id,
    encounter_index: session.current_encounter_index,
    turn_count: session.turn_count,
    save_name: session.save_name ?? null,
    saved_at: session.saved_at ?? null,
    party: existsSync(`${campaignDir()}/intake.json`)
      ? readJSON(`${campaignDir()}/intake.json`).party.map(p => `${p.name} (${p.class})`)
      : [],
    encounter_title: enc?.title ?? null,
    total_encounters: campaign?.encounters.length ?? null,
  };

  if (phase === 'complete') return res.json({ phase: 'complete', ...base });

  return res.json({
    phase: phase === 'awaiting_scene_open' ? 'awaiting_scene_open' : 'in_progress',
    encounter_status: session.encounter_status,
    ...base,
  });
});

// ── GET /campaigns ────────────────────────────────────────────────────────────

app.get('/campaigns', (req, res) => {
  const index = loadIndex().filter(e => e.status !== 'abandoned');
  return res.json(index);
});

// ── POST /campaigns/:id/load ──────────────────────────────────────────────────

app.post('/campaigns/:id/load', (req, res) => {
  const { id } = req.params;
  const targetDir = `${CAMPAIGNS_ROOT}/${id}`;
  if (!existsSync(`${targetDir}/session.json`)) {
    return res.status(404).json({ error: 'not_found', message: `Campaign ${id} not found.` });
  }

  // Save current active campaign before switching (if any)
  const currentDir = getActiveCampaignDir();
  if (currentDir && currentDir !== targetDir) {
    performSave(currentDir, null, false);
  }

  setActiveCampaignId(id);
  process.env.CAMPAIGN_DIR = targetDir;

  const session = readJSON(`${targetDir}/session.json`);
  return res.json({
    loaded: true,
    campaign_id: id,
    phase: session.encounter_status === 'complete' ? 'complete'
      : session.encounter_status === 'awaiting_scene_open' ? 'awaiting_scene_open'
      : 'in_progress',
    save_name: session.save_name ?? null,
    turn_count: session.turn_count,
  });
});

// ── POST /intake ──────────────────────────────────────────────────────────────

app.post('/intake', async (req, res) => {
  const body = req.body ?? {};

  // ── Step 1: form submit { party, preferences } ────────────────────────────
  if (body.party) {
    // Create campaign dir if needed
    let dir = getActiveCampaignDir();
    if (!dir) {
      const newId = randomUUID();
      dir = `${CAMPAIGNS_ROOT}/${newId}`;
      mkdirSync(dir, { recursive: true });
      setActiveCampaignId(newId);
      process.env.CAMPAIGN_DIR = dir;
      upsertIndexEntry({
        id: newId,
        name: 'New Campaign',
        created_at: new Date().toISOString(),
        saved_at: null,
        status: 'intake',
        encounter: null,
        encounter_index: 0,
        total_encounters: null,
        party: [],
        encounter_title: null,
      });
    }

    if (existsSync(`${dir}/session.json`)) {
      return res.status(409).json({ error: 'campaign_exists', message: 'A campaign is already running.' });
    }

    const formData = { party: body.party, preferences: body.preferences };
    try {
      intake.validate(formData);
    } catch (err) {
      return res.status(400).json({ error: 'invalid_form', message: err.message });
    }

    writeJSON(`${dir}/intake_form.json`, formData);

    try {
      const reply = await intake.review(formData);
      return res.json({ step: 'review', reply });
    } catch (err) {
      if (err?.status === 429 || err?.status === 529 || err?.status === 503) {
        return res.status(503).json({ error: 'llm_unavailable', message: err.message });
      }
      return res.status(500).json({ error: 'review_failed', message: err.message });
    }
  }

  // ── Step 2a: add details { additional } ──────────────────────────────────
  if (body.additional) {
    const dir = campaignDir();
    const formPath = `${dir}/intake_form.json`;
    if (!existsSync(formPath)) {
      return res.status(400).json({ error: 'wrong_phase', message: 'No intake form in progress.' });
    }
    const formData = readJSON(formPath);
    try {
      const intakeData = await intake.finalize(formData, body.additional);
      writeJSON(`${dir}/intake.json`, intakeData);
      rmSync(formPath);
      return res.json({ done: true });
    } catch (err) {
      if (err?.status === 429 || err?.status === 529 || err?.status === 503) {
        return res.status(503).json({ error: 'llm_unavailable', message: err.message });
      }
      return res.status(500).json({ error: 'finalize_failed', message: err.message });
    }
  }

  // ── Step 2b: skip { skip: true } ─────────────────────────────────────────
  if (body.skip) {
    const dir = campaignDir();
    const formPath = `${dir}/intake_form.json`;
    if (!existsSync(formPath)) {
      return res.status(400).json({ error: 'wrong_phase', message: 'No intake form in progress.' });
    }
    const formData = readJSON(formPath);
    try {
      intake.validate(formData);
    } catch (err) {
      return res.status(400).json({ error: 'invalid_form', message: err.message });
    }
    writeJSON(`${dir}/intake.json`, formData);
    rmSync(formPath);
    return res.json({ done: true });
  }

  return res.status(400).json({ error: 'missing_field', message: 'Body must contain "party", "additional", or "skip".' });
});

// ── POST /setup ───────────────────────────────────────────────────────────────

app.post('/setup', async (req, res) => {
  const dir = campaignDir();
  const intakePath = `${dir}/intake.json`;
  if (!existsSync(intakePath)) {
    return res.status(400).json({
      error: 'intake_incomplete',
      message: 'intake.json not found. Complete /intake before calling /setup.',
    });
  }

  if (existsSync(`${dir}/campaign.json`) && !existsSync(`${dir}/session.json`)) {
    return res.status(500).json({
      error: 'setup_failed',
      message: 'Partial campaign detected. Reset and retry from /intake.',
    });
  }

  try {
    const intakeData = readJSON(intakePath);
    const narration = await setupCampaign(intakeData);
    const convPath = `${dir}/intake_conversation.json`;
    if (existsSync(convPath)) rmSync(convPath);

    // Update registry with party and encounter info
    const session = readJSON(`${dir}/session.json`);
    const campaign = readJSON(`${dir}/campaign.json`);
    upsertIndexEntry({
      id: session.campaign_id,
      name: session.save_name ?? campaign.meta?.title ?? 'Campaign',
      status: session.encounter_status,
      encounter: session.current_encounter_id,
      encounter_index: session.current_encounter_index,
      total_encounters: campaign.encounters.length,
      party: intakeData.party.map(p => `${p.name} (${p.class})`),
      encounter_title: campaign.encounters[0]?.title ?? null,
    });

    return res.json({ narration });
  } catch (err) {
    if (err?.status === 429 || err?.status === 529 || err?.status === 503) {
      return res.status(503).json({ error: 'llm_unavailable', message: err.message });
    }
    return res.status(500).json({ error: 'setup_failed', message: err.message });
  }
});

// ── POST /save ────────────────────────────────────────────────────────────────

app.post('/save', (req, res) => {
  const dir = campaignDir();
  if (!existsSync(`${dir}/session.json`)) {
    return res.status(400).json({ error: 'no_campaign', message: 'No active campaign to save.' });
  }

  const { name, quit } = req.body ?? {};
  try {
    const result = performSave(dir, name ?? null, !!quit);
    if (!result) {
      return res.status(500).json({ error: 'save_failed', message: 'Could not write save.' });
    }
    return res.json(result);
  } catch (err) {
    console.error('[/save]', err);
    return res.status(500).json({ error: 'save_failed', message: err.message });
  }
});

// ── POST /turn ────────────────────────────────────────────────────────────────

app.post('/turn', async (req, res) => {
  const dir = campaignDir();
  const sessionPath = `${dir}/session.json`;
  if (!existsSync(sessionPath)) {
    return res.status(400).json({ error: 'wrong_phase', message: 'No active campaign. Start with POST /intake.' });
  }

  const session = readJSON(sessionPath);
  if (session.encounter_status !== 'in_progress') {
    return res.status(400).json({
      error: 'wrong_phase',
      message: `No active encounter. Current phase: ${session.encounter_status}. Call POST /scene.`,
    });
  }

  const { input } = req.body ?? {};
  if (!input) {
    return res.status(400).json({ error: 'missing_field', message: '"input" is required.' });
  }

  try {
    const result = await processTurn(input);

    if (typeof result === 'string') {
      return res.json({ narration: result });
    }

    // When campaign completes, auto-save
    if (result.campaign_complete) {
      performSave(dir, null, false);
      upsertIndexEntry({ id: session.campaign_id, status: 'complete' });
    }

    return res.json({
      narration: result.narration,
      encounter_resolved: true,
      resolution_type: result.resolution_type,
      campaign_complete: result.campaign_complete ?? false,
    });
  } catch (err) {
    if (err?.status === 429 || err?.status === 529 || err?.status === 503) {
      return res.status(503).json({ error: 'llm_unavailable', message: err.message });
    }
    return res.status(500).json({ error: 'resolver_failed', message: err.message });
  }
});

// ── POST /scene ───────────────────────────────────────────────────────────────

app.post('/scene', async (req, res) => {
  const dir = campaignDir();
  const sessionPath = `${dir}/session.json`;
  if (!existsSync(sessionPath)) {
    return res.status(400).json({ error: 'wrong_phase', message: 'No active campaign.' });
  }

  const session = readJSON(sessionPath);

  if (session.encounter_status === 'complete') {
    try {
      const narration = await narrator.closeCampaign();
      logTranscript(`## Epilogue\n\n${narration}\n`);
      return res.json({ narration, campaign_complete: true });
    } catch (err) {
      if (err?.status === 429 || err?.status === 529 || err?.status === 503) {
        return res.status(503).json({ error: 'llm_unavailable', message: err.message });
      }
      return res.status(500).json({ error: 'narrator_failed', message: err.message });
    }
  }

  if (session.encounter_status !== 'awaiting_scene_open') {
    return res.status(400).json({
      error: 'wrong_phase',
      message: `Not awaiting scene open. Current status: ${session.encounter_status}.`,
    });
  }

  try {
    const narration = await narrator.openScene();
    session.encounter_status = 'in_progress';
    writeJSON(sessionPath, session);
    logTranscript(`## New Scene\n\n${narration}\n\n---\n\n`);
    return res.json({ narration });
  } catch (err) {
    if (err?.status === 429 || err?.status === 529 || err?.status === 503) {
      return res.status(503).json({ error: 'llm_unavailable', message: err.message });
    }
    return res.status(500).json({ error: 'narrator_failed', message: err.message });
  }
});

// ── GET /adventure/summary ────────────────────────────────────────────────────

app.get('/adventure/summary', (req, res) => {
  const dir = campaignDir();
  if (!existsSync(`${dir}/session.json`)) {
    return res.status(400).json({ error: 'no_campaign', message: 'No campaign in progress.' });
  }

  const session = readJSON(`${dir}/session.json`);
  const encounterIds = session.encounter_ids ?? [];
  const sections = ['# Adventure Log\n'];

  const worldPrimerPath = `${dir}/world_primer.md`;
  if (existsSync(worldPrimerPath)) {
    sections.push(`## World\n\n${readFile(worldPrimerPath)}\n`);
  }

  for (const encId of encounterIds) {
    const summaryPath = `${dir}/encounters/${encId}_summary.md`;
    if (existsSync(summaryPath)) {
      sections.push(`## ${encId}\n\n${readFile(summaryPath)}\n`);
    }
  }

  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="adventure-summary.md"');
  return res.send(sections.join('\n---\n\n'));
});

// ── GET /adventure/transcript ─────────────────────────────────────────────────

app.get('/adventure/transcript', (req, res) => {
  const transcriptPath = `${campaignDir()}/adventure_transcript.md`;
  if (!existsSync(transcriptPath)) {
    return res.status(404).json({ error: 'not_found', message: 'No transcript available yet.' });
  }
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="adventure-transcript.md"');
  return res.send(readFile(transcriptPath));
});

// ── POST /reset ───────────────────────────────────────────────────────────────

app.post('/reset', (req, res) => {
  const dir = getActiveCampaignDir();
  if (!dir) {
    return res.status(400).json({ error: 'no_campaign', message: 'No active campaign to reset.' });
  }

  const sessionPath = `${dir}/session.json`;
  if (existsSync(sessionPath)) {
    const session = readJSON(sessionPath);
    upsertIndexEntry({ id: session.campaign_id, status: 'abandoned' });
  }

  clearActiveCampaign();
  process.env.CAMPAIGN_DIR = '';
  return res.json({ message: 'Campaign abandoned. Send POST /intake to begin a new one.' });
});

// ── Global error handler — ensures all uncaught route errors return JSON ──────

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'internal_error', message: err.message ?? 'Internal server error' });
});

// ── Start server ──────────────────────────────────────────────────────────────

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`5e RPG DM server listening on port ${PORT}`);
});

export default app;

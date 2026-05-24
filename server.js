import express from 'express';
import { existsSync } from 'fs';
import { readJSON, writeJSON } from './fileUtils.js';
import * as intake from './agents/intake.js';
import * as narrator from './agents/narrator.js';
import { setupCampaign, processTurn } from './index.js';

const app = express();
app.use(express.json());

const CAMPAIGN_DIR = process.env.CAMPAIGN_DIR ?? 'campaign';

// ── Phase detection ───────────────────────────────────────────────────────────

function getCurrentPhase() {
  const convPath = `${CAMPAIGN_DIR}/intake_conversation.json`;
  const intakePath = `${CAMPAIGN_DIR}/intake.json`;
  const sessionPath = `${CAMPAIGN_DIR}/session.json`;

  if (!existsSync(sessionPath)) {
    if (existsSync(convPath) || existsSync(intakePath)) return 'intake';
    return 'no_campaign';
  }
  const session = readJSON(sessionPath);
  if (session.encounter_status === 'complete') return 'complete';
  if (session.encounter_status === 'awaiting_scene_open') return 'awaiting_scene_open';
  return 'in_progress';
}

// ── GET /status ───────────────────────────────────────────────────────────────

app.get('/status', (req, res) => {
  const phase = getCurrentPhase();

  if (phase === 'no_campaign') {
    return res.json({ phase: 'no_campaign', message: 'No campaign in progress. Send POST /intake to begin.' });
  }

  if (phase === 'intake') {
    const convPath = `${CAMPAIGN_DIR}/intake_conversation.json`;
    const turn = existsSync(convPath)
      ? Math.floor(readJSON(convPath).messages.length / 2)
      : 0;
    return res.json({ phase: 'intake', turn });
  }

  const session = readJSON(`${CAMPAIGN_DIR}/session.json`);

  if (phase === 'complete') {
    return res.json({
      phase: 'complete',
      encounter_id: session.current_encounter_id,
      turn_count: session.turn_count,
    });
  }

  return res.json({
    phase: phase === 'awaiting_scene_open' ? 'awaiting_scene_open' : 'in_progress',
    encounter_id: session.current_encounter_id,
    encounter_index: session.current_encounter_index,
    turn_count: session.turn_count,
    encounter_status: session.encounter_status,
  });
});

// ── POST /intake ──────────────────────────────────────────────────────────────

app.post('/intake', async (req, res) => {
  if (existsSync(`${CAMPAIGN_DIR}/session.json`)) {
    return res.status(409).json({ error: 'campaign_exists', message: 'A campaign is already running.' });
  }

  const convPath = `${CAMPAIGN_DIR}/intake_conversation.json`;
  let messages;

  if (!existsSync(convPath)) {
    // First call — start fresh regardless of body
    messages = [{ role: 'user', content: 'Start the session.' }];
  } else {
    const { message } = req.body ?? {};
    if (!message) {
      return res.status(400).json({ error: 'missing_field', message: '"message" is required to continue intake.' });
    }
    const saved = readJSON(convPath);
    messages = [...saved.messages, { role: 'user', content: message }];
  }

  try {
    const result = await intake.step(messages);

    if (result.done) {
      writeJSON(`${CAMPAIGN_DIR}/intake.json`, result.intake);
      return res.json({
        done: true,
        reply: 'All information gathered. Call POST /setup to generate your campaign.',
        next: 'POST /setup',
      });
    }

    messages.push({ role: 'assistant', content: result.text });
    writeJSON(convPath, { messages });
    return res.json({ done: false, reply: result.text });
  } catch (err) {
    if (err?.status === 429 || err?.status === 529 || err?.status === 503) {
      return res.status(503).json({ error: 'llm_unavailable', message: err.message });
    }
    return res.status(500).json({ error: 'setup_failed', message: err.message });
  }
});

// ── POST /setup ───────────────────────────────────────────────────────────────

app.post('/setup', async (req, res) => {
  const intakePath = `${CAMPAIGN_DIR}/intake.json`;
  if (!existsSync(intakePath)) {
    return res.status(400).json({
      error: 'intake_incomplete',
      message: 'intake.json not found. Complete /intake before calling /setup.',
    });
  }

  // Guard against partial campaign state from a previous failed setup
  if (existsSync(`${CAMPAIGN_DIR}/campaign.json`) && !existsSync(`${CAMPAIGN_DIR}/session.json`)) {
    return res.status(500).json({
      error: 'setup_failed',
      message: 'Partial campaign detected. Delete campaign/ and retry from /intake.',
    });
  }

  try {
    const intakeData = readJSON(intakePath);
    const narration = await setupCampaign(intakeData);
    return res.json({ narration });
  } catch (err) {
    if (err?.status === 429 || err?.status === 529 || err?.status === 503) {
      return res.status(503).json({ error: 'llm_unavailable', message: err.message });
    }
    return res.status(500).json({ error: 'setup_failed', message: err.message });
  }
});

// ── POST /turn ────────────────────────────────────────────────────────────────

app.post('/turn', async (req, res) => {
  const sessionPath = `${CAMPAIGN_DIR}/session.json`;
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

    // Encounter transition: result is { closeNarration, openNarration, resolution_type }
    return res.json({
      narration: result.openNarration,
      encounter_resolved: true,
      resolution_type: result.resolution_type,
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
  const sessionPath = `${CAMPAIGN_DIR}/session.json`;
  if (!existsSync(sessionPath)) {
    return res.status(400).json({ error: 'wrong_phase', message: 'No active campaign.' });
  }

  const session = readJSON(sessionPath);
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
    return res.json({ narration });
  } catch (err) {
    if (err?.status === 429 || err?.status === 529 || err?.status === 503) {
      return res.status(503).json({ error: 'llm_unavailable', message: err.message });
    }
    return res.status(500).json({ error: 'narrator_failed', message: err.message });
  }
});

// ── Start server ──────────────────────────────────────────────────────────────

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`5e RPG DM server listening on port ${PORT}`);
});

export default app;

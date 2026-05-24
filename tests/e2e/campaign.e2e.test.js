// End-to-end campaign run — requires ANTHROPIC_API_KEY.
// Creates a fresh campaign from fixture intake, runs two encounters, and verifies
// that all required files exist and session state is correct at each phase.
//
// Cost: ~$0.15–0.50 per run (planner generation + multiple agent calls).
// Timeout: 120 seconds per test.

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;
const conditionalTest = HAS_API_KEY ? test : test.skip;

const fixtureIntake = {
  party: [
    {
      name: 'Aria',
      class: 'Rogue',
      personality: 'sardonic and observant, slow to trust',
      backstory_hook: 'Former guild enforcer who turned informant after her partner was silenced',
      playstyle_notes: 'prefers cunning over confrontation, gathers information before acting',
    },
  ],
  preferences: {
    tone: 'dark',
    primary_goal: 'expose a merchant conspiracy',
    time_available: '3 hours',
    combat_ratio: 0.3,
    problem_solving_preference: 'investigation and social manipulation',
    content_limits: [],
  },
};

let tmpDir;
let setupCampaign, processTurn, handleEncounterTransition;
let readJSON;

beforeAll(async () => {
  if (!HAS_API_KEY) return;
  tmpDir = mkdtempSync(join(tmpdir(), 'dm-e2e-'));
  process.env.CAMPAIGN_DIR = tmpDir;
  const orchestrator = await import('../../index.js');
  const fileUtils    = await import('../../fileUtils.js');
  setupCampaign           = orchestrator.setupCampaign;
  processTurn             = orchestrator.processTurn;
  handleEncounterTransition = orchestrator.handleEncounterTransition;
  readJSON                = fileUtils.readJSON;
}, 10000);

afterAll(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.CAMPAIGN_DIR;
});

// ── Setup Phase ───────────────────────────────────────────────────────────────

describe('Setup Phase', () => {
  let openingNarration;

  conditionalTest('setupCampaign completes without error', async () => {
    openingNarration = await setupCampaign(fixtureIntake);
    expect(typeof openingNarration).toBe('string');
    expect(openingNarration.length).toBeGreaterThan(20);
  }, 120000);

  conditionalTest('campaign.json is written with required top-level keys', () => {
    const campaign = readJSON(`${tmpDir}/campaign.json`);
    expect(campaign).toHaveProperty('meta');
    expect(campaign).toHaveProperty('encounters');
    expect(campaign).toHaveProperty('progress');
    expect(campaign.encounters.length).toBeGreaterThan(0);
  });

  conditionalTest('arc_brief.md exists after setup', () => {
    expect(existsSync(`${tmpDir}/arc_brief.md`)).toBe(true);
  });

  conditionalTest('world_primer.md exists after setup', () => {
    expect(existsSync(`${tmpDir}/world_primer.md`)).toBe(true);
  });

  conditionalTest('enc_001.md exists after setup', () => {
    expect(existsSync(`${tmpDir}/encounters/enc_001.md`)).toBe(true);
  });

  conditionalTest('enc_001.md does not contain resolution condition language', () => {
    const { readFileSync } = require('fs');
    const content = readFileSync(`${tmpDir}/encounters/enc_001.md`, 'utf8');
    expect(content).not.toMatch(/resolution_triggered/);
    expect(content).not.toMatch(/revelation_conditions/);
  });

  conditionalTest('session.json is written with correct initial state', () => {
    const session = readJSON(`${tmpDir}/session.json`);
    expect(session.current_encounter_index).toBe(0);
    expect(session.encounter_status).toBe('in_progress');
    expect(session.turn_count).toBe(0);
    expect(Array.isArray(session.player_inputs)).toBe(true);
    expect(Array.isArray(session.encounter_ids)).toBe(true);
    expect(session.encounter_ids.length).toBeGreaterThan(0);
  });

  conditionalTest('player narrator card is created from intake data', () => {
    expect(existsSync(`${tmpDir}/players/aria/aria_narrator.md`)).toBe(true);
  });
});

// ── Turn Loop — Encounter 1 ───────────────────────────────────────────────────

describe('Turn Loop (Encounter 1)', () => {
  conditionalTest('first processTurn returns non-empty narration', async () => {
    const result = await processTurn('We approach Vesper carefully, hands visible.');
    // If resolution triggered, result is an object; otherwise a string
    const narration = typeof result === 'string' ? result : result.openNarration;
    expect(typeof narration).toBe('string');
    expect(narration.length).toBeGreaterThan(20);
  }, 60000);

  conditionalTest('session.json is updated after a turn', () => {
    const session = readJSON(`${tmpDir}/session.json`);
    expect(session.turn_count).toBeGreaterThanOrEqual(1);
    expect(session.player_inputs.length).toBeGreaterThanOrEqual(1);
  });

  conditionalTest('second processTurn returns narration without error', async () => {
    const session = readJSON(`${tmpDir}/session.json`);
    if (session.encounter_status !== 'in_progress') return; // already transitioned
    const result = await processTurn('We ask Vesper what she saw that night.');
    const narration = typeof result === 'string' ? result : result.openNarration;
    expect(typeof narration).toBe('string');
    expect(narration.length).toBeGreaterThan(20);
  }, 60000);
});

// ── Encounter Transition ──────────────────────────────────────────────────────

describe('Encounter Transition', () => {
  const victoryResult = {
    encounter_id: 'enc_001',
    turn: 3,
    revelation_triggers: [],
    resolution_triggered: 'victory',
    object_state_changes: [],
    npc_attitude_changes: [],
    encounter_continues: false,
    requires_narrative_update: false,
    notes: 'e2e test forced transition',
  };

  conditionalTest('handleEncounterTransition returns closeNarration and openNarration', async () => {
    const result = await handleEncounterTransition(victoryResult);
    expect(result).toHaveProperty('closeNarration');
    expect(result).toHaveProperty('openNarration');
    expect(typeof result.closeNarration).toBe('string');
    expect(typeof result.openNarration).toBe('string');
  }, 120000);

  conditionalTest('encounter summary file is written after transition', () => {
    expect(existsSync(`${tmpDir}/encounters/enc_001_summary.md`)).toBe(true);
  });

  conditionalTest('session is reset for encounter 2 after transition', () => {
    const session = readJSON(`${tmpDir}/session.json`);
    expect(session.current_encounter_index).toBe(1);
    expect(session.turn_count).toBe(0);
    expect(session.player_inputs).toHaveLength(0);
    expect(session.prev_encounter_id).toBe('enc_001');
  });

  conditionalTest('campaign.json progress reflects new encounter', () => {
    const campaign = readJSON(`${tmpDir}/campaign.json`);
    // Progress should reflect completed enc_001 — current may be enc_002 now
    expect(campaign.encounters[0].status).toBe('completed');
  });
});

// ── Second Encounter Turn ─────────────────────────────────────────────────────

describe('Second Encounter Turn', () => {
  conditionalTest('processTurn works in encounter 2', async () => {
    const session = readJSON(`${tmpDir}/session.json`);
    if (session.current_encounter_index < 1) return; // transition not complete
    const result = await processTurn('We enter the harbor authority building quietly.');
    const narration = typeof result === 'string' ? result : result.openNarration;
    expect(typeof narration).toBe('string');
    expect(narration.length).toBeGreaterThan(20);
  }, 60000);
});

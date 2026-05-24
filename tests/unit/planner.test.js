import { jest, describe, test, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';

// ── mock Anthropic SDK ────────────────────────────────────────────────────────

const mockCreate = jest.fn();

jest.unstable_mockModule('@anthropic-ai/sdk', () => ({
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

// ── import planner after mocks ────────────────────────────────────────────────

let generateCampaign, applyRevelations, updateNarrativeForStateChanges, closeEncounter, openNextEncounter;
let tmpDir;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'planner-test-'));
  process.env.CAMPAIGN_DIR = tmpDir;
  const mod = await import('../../agents/planner.js');
  generateCampaign = mod.generateCampaign;
  applyRevelations = mod.applyRevelations;
  updateNarrativeForStateChanges = mod.updateNarrativeForStateChanges;
  closeEncounter = mod.closeEncounter;
  openNextEncounter = mod.openNextEncounter;
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.CAMPAIGN_DIR;
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ── helpers ───────────────────────────────────────────────────────────────────

function writeTmpFile(relPath, content) {
  const full = join(tmpDir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
}

function readTmpFile(relPath) {
  return readFileSync(join(tmpDir, relPath), 'utf8');
}

function apiReturnsText(text) {
  mockCreate.mockResolvedValue({ content: [{ text }] });
}

function apiReturnsJSON(obj) {
  mockCreate.mockResolvedValue({ content: [{ text: JSON.stringify(obj) }] });
}

// ── fixtures ──────────────────────────────────────────────────────────────────

const baseIntake = {
  party: [{ name: 'Aria', class: 'Rogue', personality: 'sardonic', backstory_hook: 'guild fugitive', playstyle_notes: 'cunning' }],
  preferences: { tone: 'dark', primary_goal: 'conspiracy', time_available: '3 hours', combat_ratio: 0.3, problem_solving_preference: 'investigation', content_limits: [] },
};

const validCampaign = {
  meta: { campaign_id: 'test-001', title: 'Test Campaign', created_at: '2026-01-01T00:00:00Z', estimated_duration_hours: 3, arc_length: 3 },
  tone: { mood: 'dark', pacing: 'slow-burn', combat_ratio: 0.3, narrative_style: 'noir' },
  arc: { premise: 'A conspiracy', central_conflict: 'Expose the magistrate', final_revelation: 'Shadow council', themes: ['corruption'] },
  encounters: [
    {
      id: 'enc_001', index: 0, title: 'First Encounter', status: 'current', outcome: null,
      location_id: 'loc_001', npcs: [],
      revelation_conditions: [{ id: 'cond_1', condition: 'players search', reveals: 'A ledger', triggered: false }],
      resolution_conditions: {
        victory: { condition: 'escape with ledger', triggered: false },
        failure: { condition: 'captured', triggered: false },
        partial: { condition: 'escape without ledger', triggered: false },
      },
    },
  ],
  location_secrets: {},
  progress: { current_encounter_index: 0, current_encounter_id: 'enc_001', session_status: 'awaiting_player_input', revealed_plot_threads: [], unrevealed_plot_threads: [] },
  world_state: { npc_attitudes: {}, items_in_play: [], locations_visited: [], flags: {} },
  files: { arc_brief: 'arc_brief.md', world_primer: 'world_primer.md', encounters_dir: 'encounters/', npcs_dir: 'npcs/', locations_dir: 'locations/', players_dir: 'players/' },
};

const sampleGenerateResponse = [
  `<file path="campaign.json">`,
  JSON.stringify(validCampaign),
  `</file>`,
  `<file path="arc_brief.md">`,
  `# Test Arc Brief`,
  `</file>`,
  `<file path="world_primer.md">`,
  `# World Primer\n\nThe city of Valdenmere.`,
  `</file>`,
].join('\n');

const validBundle = {
  npc_updates: [],
  player_updates: [],
  location_updates: [],
  campaign_updates: {},
};

// ── generateCampaign ──────────────────────────────────────────────────────────

describe('generateCampaign', () => {
  test('parses <file> tags and writes multiple files', async () => {
    apiReturnsText(sampleGenerateResponse);
    await generateCampaign(baseIntake);
    expect(readTmpFile('arc_brief.md')).toBe('# Test Arc Brief');
    expect(readTmpFile('world_primer.md')).toContain('Valdenmere');
  });

  test('writes campaign.json as parsed JSON', async () => {
    apiReturnsText(sampleGenerateResponse);
    await generateCampaign(baseIntake);
    const parsed = JSON.parse(readTmpFile('campaign.json'));
    expect(parsed.meta.campaign_id).toBe('test-001');
    expect(parsed.encounters).toHaveLength(1);
  });

  test('calls API with max_tokens 8096', async () => {
    apiReturnsText(sampleGenerateResponse);
    await generateCampaign(baseIntake);
    expect(mockCreate.mock.calls[0][0].max_tokens).toBe(8096);
  });

  test('calls API exactly once', async () => {
    apiReturnsText(sampleGenerateResponse);
    await generateCampaign(baseIntake);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  test('throws when no <file> tags in response', async () => {
    apiReturnsText('Here is your campaign, sorry no tags!');
    await expect(generateCampaign(baseIntake)).rejects.toThrow('no <file> tags');
  });

  test('throws when campaign.json tag is missing', async () => {
    apiReturnsText('<file path="arc_brief.md">content</file>');
    await expect(generateCampaign(baseIntake)).rejects.toThrow('campaign.json not found');
  });

  test('throws when a JSON file contains invalid JSON', async () => {
    apiReturnsText('<file path="campaign.json">not-valid-json</file>');
    await expect(generateCampaign(baseIntake)).rejects.toThrow('invalid JSON');
  });
});

// ── applyRevelations ──────────────────────────────────────────────────────────

describe('applyRevelations', () => {
  beforeEach(() => {
    writeTmpFile('session.json', { current_encounter_id: 'enc_001', current_encounter_index: 0, turn_count: 2 });
    writeTmpFile('campaign.json', {
      encounters: [{
        id: 'enc_001', index: 0,
        revelation_conditions: [{ id: 'cond_1', condition: 'players search', reveals: 'A ledger was found', triggered: false }],
      }],
      location_secrets: {},
    });
    writeTmpFile('arc_brief.md', '# Arc Brief');
    writeTmpFile('encounters/enc_001.md', '# Enc 001\n\n## Scene Setting\nA tavern.');
  });

  test('appends <append> content to the target file', async () => {
    const appendContent = '<append path="encounters/enc_001.md">\n## REVEALED — Turn 2\nThe ledger is behind the bar.\n</append>';
    apiReturnsText(appendContent);
    await applyRevelations(['cond_1']);
    const content = readTmpFile('encounters/enc_001.md');
    expect(content).toContain('## REVEALED — Turn 2');
  });

  test('handles multiple <append> tags in one response', async () => {
    writeTmpFile('npcs/barkeep/barkeep_narrator.md', '# Barkeep');
    const appendContent = [
      '<append path="encounters/enc_001.md">\n## REVEALED — Turn 2\nLedger content.\n</append>',
      '<append path="npcs/barkeep/barkeep_narrator.md">\n## REVEALED — Enc 001, Turn 2\nBarkeep is nervous.\n</append>',
    ].join('\n');
    apiReturnsText(appendContent);
    await applyRevelations(['cond_1']);
    expect(readTmpFile('encounters/enc_001.md')).toContain('Ledger content');
    expect(readTmpFile('npcs/barkeep/barkeep_narrator.md')).toContain('Barkeep is nervous');
  });

  test('includes triggered condition details in user message', async () => {
    apiReturnsText('<append path="encounters/enc_001.md">\n## REVEALED — Turn 2\nContent.\n</append>');
    await applyRevelations(['cond_1']);
    const userContent = mockCreate.mock.calls[0][0].messages[0].content;
    expect(userContent).toContain('cond_1');
    expect(userContent).toContain('A ledger was found');
  });

  test('returns without calling API when trigger IDs do not match any condition', async () => {
    await applyRevelations(['nonexistent_cond']);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('resolves silently when LLM returns no <append> tags', async () => {
    apiReturnsText('No changes needed.');
    await expect(applyRevelations(['cond_1'])).resolves.toBeUndefined();
  });
});

// ── updateNarrativeForStateChanges ────────────────────────────────────────────

describe('updateNarrativeForStateChanges', () => {
  beforeEach(() => {
    writeTmpFile('locations/pier_wharf/pier_wharf_narrator.md', '# Pier Wharf\n\n## Atmosphere\nCold and dark.');
  });

  test('appends prose update to location narrator card', async () => {
    const appendContent = '<append path="locations/pier_wharf/pier_wharf_narrator.md">\n## Post-Turn Update\nThe crates were disturbed.\n</append>';
    apiReturnsText(appendContent);
    const changes = [{ location: 'pier_wharf', object_id: 'fish_crates', new_state: 'disturbed', interacted_by: 'party', interaction: 'hid behind' }];
    await updateNarrativeForStateChanges(changes);
    expect(readTmpFile('locations/pier_wharf/pier_wharf_narrator.md')).toContain('disturbed');
  });

  test('returns without calling API when changes is empty', async () => {
    await updateNarrativeForStateChanges([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('returns without calling API when changes is undefined', async () => {
    await updateNarrativeForStateChanges(undefined);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// ── closeEncounter ────────────────────────────────────────────────────────────

describe('closeEncounter', () => {
  beforeEach(() => {
    writeTmpFile('session.json', { current_encounter_id: 'enc_001', current_encounter_index: 0, turn_count: 5 });
    writeTmpFile('campaign.json', {
      encounters: [{ id: 'enc_001', index: 0, npcs: [] }],
    });
    writeTmpFile('arc_brief.md', '# Arc Brief');
    writeTmpFile('encounters/enc_001.md', '# Enc 001');
  });

  test('returns parsed reconciliation bundle', async () => {
    apiReturnsJSON(validBundle);
    const result = await closeEncounter({ encounter_summary: 'Summary text', resolver_result: {} });
    expect(result).toEqual(validBundle);
  });

  test('strips markdown fences from response', async () => {
    apiReturnsText('```json\n' + JSON.stringify(validBundle) + '\n```');
    const result = await closeEncounter({ encounter_summary: 'x', resolver_result: {} });
    expect(result).toEqual(validBundle);
  });

  test('throws on invalid JSON response', async () => {
    apiReturnsText('This is not valid JSON at all');
    await expect(closeEncounter({ encounter_summary: 'x', resolver_result: {} })).rejects.toThrow('invalid JSON');
  });

  test('throws when npc_updates key is missing', async () => {
    const { npc_updates: _, ...without } = validBundle;
    apiReturnsJSON(without);
    await expect(closeEncounter({ encounter_summary: 'x', resolver_result: {} })).rejects.toThrow('"npc_updates"');
  });

  test('throws when player_updates key is missing', async () => {
    const { player_updates: _, ...without } = validBundle;
    apiReturnsJSON(without);
    await expect(closeEncounter({ encounter_summary: 'x', resolver_result: {} })).rejects.toThrow('"player_updates"');
  });

  test('includes encounter summary in user message', async () => {
    apiReturnsJSON(validBundle);
    await closeEncounter({ encounter_summary: 'The players found the ledger.', resolver_result: {} });
    const userContent = mockCreate.mock.calls[0][0].messages[0].content;
    expect(userContent).toContain('The players found the ledger.');
  });

  test('calls API with max_tokens 4096', async () => {
    apiReturnsJSON(validBundle);
    await closeEncounter({ encounter_summary: 'x', resolver_result: {} });
    expect(mockCreate.mock.calls[0][0].max_tokens).toBe(4096);
  });
});

// ── openNextEncounter ─────────────────────────────────────────────────────────

describe('openNextEncounter', () => {
  const nextEnc = { id: 'enc_002', index: 1, title: 'Next Encounter', npcs: [], location_id: 'loc_001' };
  const onScriptResult = { outcome: 'on_script', notes: 'As expected', file_updates: [] };
  const divergedResult = {
    outcome: 'diverged',
    notes: 'Players learned more than expected',
    file_updates: [{ path: 'encounters/enc_002.md', content: '# Updated Enc 002\n\nChanged scene.' }],
  };

  beforeEach(() => {
    writeTmpFile('arc_brief.md', '# Arc Brief');
    writeTmpFile('encounters/enc_002.md', '# Enc 002\n\nOriginal content.');
  });

  test('returns on_script result', async () => {
    apiReturnsJSON(onScriptResult);
    const result = await openNextEncounter({ completed_summary: 'Summary', next_encounter: nextEnc, player_states: [], campaign_progress: {} });
    expect(result.outcome).toBe('on_script');
  });

  test('returns empty file_updates for on_script', async () => {
    apiReturnsJSON(onScriptResult);
    const result = await openNextEncounter({ completed_summary: 'Summary', next_encounter: nextEnc, player_states: [], campaign_progress: {} });
    expect(result.file_updates).toEqual([]);
  });

  test('writes file updates for diverged outcome', async () => {
    apiReturnsJSON(divergedResult);
    await openNextEncounter({ completed_summary: 'Summary', next_encounter: nextEnc, player_states: [], campaign_progress: {} });
    const content = readTmpFile('encounters/enc_002.md');
    expect(content).toBe('# Updated Enc 002\n\nChanged scene.');
  });

  test('throws when outcome field is missing', async () => {
    apiReturnsJSON({ notes: 'x', file_updates: [] });
    await expect(openNextEncounter({ completed_summary: 'x', next_encounter: nextEnc, player_states: [], campaign_progress: {} })).rejects.toThrow('"outcome"');
  });

  test('throws when file_updates is not an array', async () => {
    apiReturnsJSON({ outcome: 'on_script', notes: 'x', file_updates: null });
    await expect(openNextEncounter({ completed_summary: 'x', next_encounter: nextEnc, player_states: [], campaign_progress: {} })).rejects.toThrow('"file_updates"');
  });

  test('throws on invalid JSON response', async () => {
    apiReturnsText('not json');
    await expect(openNextEncounter({ completed_summary: 'x', next_encounter: nextEnc, player_states: [], campaign_progress: {} })).rejects.toThrow('invalid JSON');
  });
});

// ── retry behaviour ───────────────────────────────────────────────────────────

describe('retry behaviour', () => {
  test('retries generateCampaign on 429 and succeeds on second attempt', async () => {
    const rateLimitError = Object.assign(new Error('rate limited'), { status: 429 });
    mockCreate
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce({ content: [{ text: sampleGenerateResponse }] });
    await generateCampaign(baseIntake);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  test('throws immediately on non-retriable error', async () => {
    const badRequestError = Object.assign(new Error('bad request'), { status: 400 });
    mockCreate.mockRejectedValue(badRequestError);
    await expect(generateCampaign(baseIntake)).rejects.toThrow('bad request');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

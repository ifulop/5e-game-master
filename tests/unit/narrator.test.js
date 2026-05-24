import { jest, describe, test, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';

// ── mock Anthropic SDK ────────────────────────────────────────────────────────

const mockCreate = jest.fn();

jest.unstable_mockModule('@anthropic-ai/sdk', () => ({
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

// ── import narrator after mocks ───────────────────────────────────────────────

let openScene, continueTurn, closeEncounter, closeCampaign;
let tmpDir;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'narrator-test-'));
  process.env.CAMPAIGN_DIR = tmpDir;
  const mod = await import('../../agents/narrator.js');
  openScene = mod.openScene;
  continueTurn = mod.continueTurn;
  closeEncounter = mod.closeEncounter;
  closeCampaign = mod.closeCampaign;
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.CAMPAIGN_DIR;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockResolvedValue({ content: [{ text: 'Narrated response.' }] });
});

// ── helpers ───────────────────────────────────────────────────────────────────

function writeTmpFile(relPath, content) {
  const full = join(tmpDir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
}

function apiReturnsText(text) {
  mockCreate.mockResolvedValue({ content: [{ text }] });
}

function getCallSystemText(callIndex = 0) {
  const system = mockCreate.mock.calls[callIndex][0].system ?? [];
  return system.map(s => s.text).join('\n');
}

function getCallUserMessage(callIndex = 0) {
  return mockCreate.mock.calls[callIndex][0].messages[0].content;
}

function getAllCallText(callIndex = 0) {
  return `${getCallSystemText(callIndex)}\n${getCallUserMessage(callIndex)}`;
}

// ── standard fixtures ─────────────────────────────────────────────────────────

const baseSession = {
  current_encounter_id: 'enc_001',
  current_encounter_index: 0,
  turn_count: 2,
  player_inputs: ['We enter cautiously', 'I look around'],
};

const baseCampaign = {
  encounters: [{
    id: 'enc_001',
    index: 0,
    title: 'The Tavern',
    location_id: 'loc_001',
    npcs: ['barkeep'],
    revelation_conditions: [],
    resolution_conditions: {
      victory: { condition: 'FORBIDDEN_CONDITION_TEXT', triggered: false },
    },
  }],
};

function writeBaseFixtures() {
  writeTmpFile('session.json', baseSession);
  writeTmpFile('campaign.json', baseCampaign);
  writeTmpFile('world_primer.md', '# World Primer\n\nA dark city.');
  writeTmpFile('intake.json', { party: [{ name: 'Aria', class: 'Rogue' }] });
  writeTmpFile('encounters/enc_001.md', '# Enc 001\n\n## Scene Setting\nA smoky tavern.');
  writeTmpFile('players/aria/aria_narrator.md', '# Aria\n\nA rogue with trust issues.');
  writeTmpFile('npcs/barkeep/barkeep_narrator.md', '# Barkeep\n\nA cautious old man.');
  writeTmpFile('locations/loc_001/loc_001_narrator.md', '# The Tinder Box\n\nWarm, smoky, dangerous.');
}

// ── openScene ─────────────────────────────────────────────────────────────────

describe('openScene', () => {
  beforeEach(writeBaseFixtures);

  test('returns narration text from LLM', async () => {
    apiReturnsText('The door creaks open.');
    const result = await openScene();
    expect(result).toBe('The door creaks open.');
  });

  test('loads enc_XXX.md content into context', async () => {
    await openScene();
    expect(getCallSystemText()).toContain('A smoky tavern.');
  });

  test('loads NPC narrator card for active NPCs', async () => {
    await openScene();
    expect(getCallSystemText()).toContain('A cautious old man.');
  });

  test('loads location narrator card', async () => {
    await openScene();
    expect(getCallSystemText()).toContain('Warm, smoky, dangerous.');
  });

  test('loads world_primer.md into system prompt', async () => {
    await openScene();
    expect(getCallSystemText()).toContain('A dark city.');
  });

  test('loads player cards into system prompt', async () => {
    await openScene();
    expect(getCallSystemText()).toContain('A rogue with trust issues.');
  });

  test('does NOT include turn history (fresh context window for scene open)', async () => {
    await openScene();
    expect(getAllCallText()).not.toContain('We enter cautiously');
    expect(getAllCallText()).not.toContain('I look around');
  });

  test('loads previous encounter summary when not first encounter', async () => {
    writeTmpFile('session.json', { ...baseSession, current_encounter_index: 1, current_encounter_id: 'enc_002' });
    writeTmpFile('campaign.json', {
      encounters: [
        { id: 'enc_001', index: 0, title: 'Enc 1', location_id: 'loc_001', npcs: [] },
        { id: 'enc_002', index: 1, title: 'Enc 2', location_id: 'loc_001', npcs: [] },
      ],
    });
    writeTmpFile('encounters/enc_001_summary.md', 'Players found the ledger.');
    writeTmpFile('encounters/enc_002.md', '# Enc 002\n\nThe docks.');
    await openScene();
    expect(getCallSystemText()).toContain('Players found the ledger.');
  });

  test('omits previous summary when on first encounter', async () => {
    await openScene();
    const text = getCallSystemText();
    expect(text).not.toContain('Previous Encounter Summary');
  });
});

// ── continueTurn ──────────────────────────────────────────────────────────────

describe('continueTurn', () => {
  beforeEach(writeBaseFixtures);

  test('returns narration text from LLM', async () => {
    apiReturnsText('The barkeep eyes you warily.');
    const result = await continueTurn('I approach the bar');
    expect(result).toBe('The barkeep eyes you warily.');
  });

  test('player input is the user message', async () => {
    await continueTurn('I approach the bar');
    expect(getCallUserMessage()).toBe('I approach the bar');
  });

  test('includes encounter brief in context', async () => {
    await continueTurn('I look around');
    expect(getCallSystemText()).toContain('A smoky tavern.');
  });

  test('includes NPC cards in context', async () => {
    await continueTurn('I talk to the barkeep');
    expect(getCallSystemText()).toContain('A cautious old man.');
  });

  test('includes previous turns in context (excludes current)', async () => {
    writeTmpFile('session.json', { ...baseSession, player_inputs: ['First action', 'Second action', 'Third action'] });
    await continueTurn('Third action');
    const text = getCallSystemText();
    expect(text).toContain('First action');
    expect(text).toContain('Second action');
    expect(text).not.toContain('Third action');
  });
});

// ── closeEncounter ────────────────────────────────────────────────────────────

describe('closeEncounter', () => {
  beforeEach(writeBaseFixtures);

  test('returns narration text from LLM', async () => {
    apiReturnsText('The dust settles.');
    const result = await closeEncounter({ resolution_triggered: 'victory' });
    expect(result).toBe('The dust settles.');
  });

  test('resolution type appears in user message', async () => {
    await closeEncounter({ resolution_triggered: 'victory' });
    expect(getCallUserMessage()).toContain('victory');
  });

  test('resolution type failure appears in user message', async () => {
    await closeEncounter({ resolution_triggered: 'failure' });
    expect(getCallUserMessage()).toContain('failure');
  });

  test('includes full turn history including resolution turn', async () => {
    await closeEncounter({ resolution_triggered: 'victory' });
    const text = getCallSystemText();
    expect(text).toContain('We enter cautiously');
    expect(text).toContain('I look around');
  });
});

// ── closeCampaign ─────────────────────────────────────────────────────────────

describe('closeCampaign', () => {
  beforeEach(() => {
    writeBaseFixtures();
    writeTmpFile('encounters/enc_001_summary.md', '# Enc 001 Summary\n\nThe party escaped.');
  });

  test('returns narration text from LLM', async () => {
    apiReturnsText('And so the tale ends.');
    const result = await closeCampaign();
    expect(result).toBe('And so the tale ends.');
  });

  test('includes all available encounter summaries', async () => {
    writeTmpFile('campaign.json', {
      encounters: [
        { id: 'enc_001', index: 0, title: 'Enc 1', location_id: 'loc_001', npcs: [] },
        { id: 'enc_002', index: 1, title: 'Enc 2', location_id: 'loc_001', npcs: [] },
      ],
    });
    writeTmpFile('encounters/enc_002_summary.md', '# Enc 002 Summary\n\nThe party confronted the magistrate.');
    await closeCampaign();
    const text = getCallSystemText();
    expect(text).toContain('The party escaped.');
    expect(text).toContain('confronted the magistrate');
  });

  test('uses max_tokens 2048', async () => {
    await closeCampaign();
    expect(mockCreate.mock.calls[0][0].max_tokens).toBe(2048);
  });
});

// ── information separation ────────────────────────────────────────────────────

describe('information separation', () => {
  beforeEach(writeBaseFixtures);

  test('arc_brief.md content is never passed to LLM', async () => {
    writeTmpFile('arc_brief.md', 'TOP_SECRET_ARC_CONTENT_XYZ');
    await openScene();
    expect(getAllCallText()).not.toContain('TOP_SECRET_ARC_CONTENT_XYZ');
  });

  test('npc_hidden.md content is never passed to LLM', async () => {
    writeTmpFile('npcs/barkeep/barkeep_hidden.md', 'HIDDEN_BARKEEP_AGENDA_XYZ');
    await openScene();
    expect(getAllCallText()).not.toContain('HIDDEN_BARKEEP_AGENDA_XYZ');
  });

  test('campaign.json resolution condition text is never passed to LLM', async () => {
    await openScene();
    expect(getAllCallText()).not.toContain('FORBIDDEN_CONDITION_TEXT');
  });
});

// ── cache_control ─────────────────────────────────────────────────────────────

describe('cache_control', () => {
  beforeEach(writeBaseFixtures);

  test('first system block has cache_control ephemeral (base + world primer)', async () => {
    await openScene();
    const system = mockCreate.mock.calls[0][0].system;
    expect(system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(system[0].text).toContain('A dark city.');
  });

  test('second system block (player cards) has cache_control ephemeral', async () => {
    await openScene();
    const system = mockCreate.mock.calls[0][0].system;
    expect(system[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(system[1].text).toContain('Player Cards');
  });
});

// ── retry behaviour ───────────────────────────────────────────────────────────

describe('retry behaviour', () => {
  beforeEach(writeBaseFixtures);

  test('retries openScene on 429 and succeeds on second attempt', async () => {
    const rateLimitError = Object.assign(new Error('rate limited'), { status: 429 });
    mockCreate
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce({ content: [{ text: 'Retried successfully.' }] });
    const result = await openScene();
    expect(result).toBe('Retried successfully.');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  test('throws immediately on non-retriable error', async () => {
    const badRequest = Object.assign(new Error('bad request'), { status: 400 });
    mockCreate.mockRejectedValue(badRequest);
    await expect(openScene()).rejects.toThrow('bad request');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

import { jest, describe, test, expect, beforeAll, beforeEach } from '@jest/globals';

// ─── fixture data ──────────────────────────────────────────────────────────

const fixtureCampaign = {
  meta: { campaign_id: 'test-001' },
  encounters: [
    {
      id: 'enc_001', index: 0, location_id: 'loc_001', npcs: [],
      revelation_conditions: [],
      resolution_conditions: {
        victory: { condition: 'test', triggered: false },
        failure: { condition: 'test', triggered: false },
        partial:  { condition: 'test', triggered: false }
      }
    },
    {
      id: 'enc_002', index: 1, location_id: 'loc_001', npcs: [],
      revelation_conditions: [],
      resolution_conditions: {
        victory: { condition: 'test', triggered: false },
        failure: { condition: 'test', triggered: false },
        partial:  { condition: 'test', triggered: false }
      }
    }
  ],
  location_secrets: {},
  progress: { current_encounter_index: 0, current_encounter_id: 'enc_001' }
};

const baseSession = {
  campaign_id: 'test-001',
  current_encounter_index: 0,
  current_encounter_id: 'enc_001',
  encounter_status: 'in_progress',
  turn_count: 0,
  player_inputs: []
};

const baseResult = {
  encounter_id: 'enc_001', turn: 1,
  revelation_triggers: [], resolution_triggered: null,
  object_state_changes: [], npc_attitude_changes: [],
  encounter_continues: true, requires_narrative_update: false, notes: ''
};

// ─── mock objects ──────────────────────────────────────────────────────────

const mockNarrator = {
  openScene:       jest.fn().mockResolvedValue('scene opened'),
  continueTurn:    jest.fn().mockResolvedValue('narration'),
  closeEncounter:  jest.fn().mockResolvedValue('encounter closed'),
  closeCampaign:   jest.fn().mockResolvedValue('campaign ended'),
};
const mockResolver   = { evaluate: jest.fn() };
const mockPlanner    = {
  generateCampaign:               jest.fn().mockResolvedValue(undefined),
  applyRevelations:               jest.fn().mockResolvedValue(undefined),
  updateNarrativeForStateChanges: jest.fn().mockResolvedValue(undefined),
  closeEncounter:                 jest.fn().mockResolvedValue({}),
  openNextEncounter:              jest.fn().mockResolvedValue(undefined),
};
const mockSummarizer = { summarize: jest.fn().mockResolvedValue('summary') };
const mockIntake     = { run: jest.fn().mockResolvedValue({}) };
const mockSM         = {
  applyObjectChanges:       jest.fn(),
  applyAttitudeChanges:     jest.fn(),
  applyReconciliationBundle: jest.fn(),
};
const mockReadJSON  = jest.fn();
const mockWriteJSON = jest.fn();
const mockWriteFile = jest.fn();
const mockGetEncounterExchange = jest.fn().mockReturnValue('Turn 1: test input');

// ─── module mocks ──────────────────────────────────────────────────────────

jest.unstable_mockModule('../../agents/narrator.js',   () => mockNarrator);
jest.unstable_mockModule('../../agents/resolver.js',   () => mockResolver);
jest.unstable_mockModule('../../agents/planner.js',    () => mockPlanner);
jest.unstable_mockModule('../../agents/summarizer.js', () => mockSummarizer);
jest.unstable_mockModule('../../agents/intake.js',     () => mockIntake);
jest.unstable_mockModule('../../stateManager.js',      () => ({ StateManager: jest.fn(() => mockSM) }));
jest.unstable_mockModule('../../fileUtils.js',         () => ({
  readJSON:             mockReadJSON,
  writeJSON:            mockWriteJSON,
  writeFile:            mockWriteFile,
  readFile:             jest.fn(),
  appendToFile:         jest.fn(),
  getEncounterExchange: mockGetEncounterExchange,
}));

// ─── import orchestrator after mocks ──────────────────────────────────────

let processTurn, handleEncounterTransition;

beforeAll(async () => {
  const mod = await import('../../index.js');
  processTurn              = mod.processTurn;
  handleEncounterTransition = mod.handleEncounterTransition;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockReadJSON.mockImplementation((path) => {
    if (path.includes('campaign.json')) return JSON.parse(JSON.stringify(fixtureCampaign));
    if (path.includes('session.json'))  return JSON.parse(JSON.stringify(baseSession));
    return {};
  });
  mockResolver.evaluate.mockResolvedValue({ ...baseResult });
});

// ─── Resolver Failure ─────────────────────────────────────────────────────

describe('Resolver failure', () => {
  test('resolver failure does not write session.json', async () => {
    mockResolver.evaluate.mockRejectedValue(new Error('LLM call failed'));
    await expect(processTurn('test input')).rejects.toThrow('LLM call failed');
    const sessionWrites = mockWriteJSON.mock.calls.filter(([p]) => p.includes('session.json'));
    expect(sessionWrites).toHaveLength(0);
  });

  test('resolver failure propagates the error to the caller', async () => {
    const err = Object.assign(new Error('resolver timeout'), { status: 500 });
    mockResolver.evaluate.mockRejectedValue(err);
    await expect(processTurn('test input')).rejects.toThrow('resolver timeout');
  });
});

// ─── Revelation Append Failure ────────────────────────────────────────────

describe('applyRevelations failure', () => {
  test('failure stores triggers in session.pending_revelation_triggers', async () => {
    mockResolver.evaluate.mockResolvedValue({ ...baseResult, revelation_triggers: ['rev_001'] });
    mockPlanner.applyRevelations.mockRejectedValue(new Error('planner failed'));

    await processTurn('test input');

    const sessionWrites = mockWriteJSON.mock.calls.filter(([p]) => p.includes('session.json'));
    const lastWrite = sessionWrites[sessionWrites.length - 1][1];
    expect(lastWrite.pending_revelation_triggers).toEqual(['rev_001']);
  });

  test('turn still completes (narrator runs) when revelation append fails', async () => {
    mockResolver.evaluate.mockResolvedValue({ ...baseResult, revelation_triggers: ['rev_001'] });
    mockPlanner.applyRevelations.mockRejectedValue(new Error('planner failed'));

    const result = await processTurn('test input');

    expect(result).toBe('narration');
    expect(mockNarrator.continueTurn).toHaveBeenCalled();
  });
});

// ─── Pending Triggers Retry ───────────────────────────────────────────────

describe('Pending revelation triggers', () => {
  test('pending triggers from previous turn are retried before resolver', async () => {
    mockReadJSON.mockImplementation((path) => {
      if (path.includes('campaign.json')) return JSON.parse(JSON.stringify(fixtureCampaign));
      if (path.includes('session.json')) return {
        ...baseSession,
        pending_revelation_triggers: ['rev_from_last_turn']
      };
      return {};
    });

    const order = [];
    mockPlanner.applyRevelations.mockImplementation(() => {
      order.push('applyRevelations');
      return Promise.resolve();
    });
    mockResolver.evaluate.mockImplementation(async () => {
      order.push('resolver');
      return { ...baseResult };
    });

    await processTurn('test input');

    expect(mockPlanner.applyRevelations).toHaveBeenCalledWith(['rev_from_last_turn']);
    expect(order.indexOf('applyRevelations')).toBeLessThan(order.indexOf('resolver'));
  });

  test('successfully retried triggers are removed from session.json', async () => {
    mockReadJSON.mockImplementation((path) => {
      if (path.includes('campaign.json')) return JSON.parse(JSON.stringify(fixtureCampaign));
      if (path.includes('session.json')) return {
        ...baseSession,
        pending_revelation_triggers: ['rev_stale']
      };
      return {};
    });

    await processTurn('test input');

    // The cleanup write (after successful retry) should have no pending_revelation_triggers
    const sessionWrites = mockWriteJSON.mock.calls.filter(([p]) => p.includes('session.json'));
    const cleanupWrite = sessionWrites.find(([, data]) => !data.pending_revelation_triggers);
    expect(cleanupWrite).toBeDefined();
  });
});

// ─── Summarizer Failure Fallback ─────────────────────────────────────────

describe('Summarizer failure fallback', () => {
  test('summarizer failure passes raw exchange to planner.closeEncounter', async () => {
    mockSummarizer.summarize.mockRejectedValue(new Error('summarizer timed out'));
    mockGetEncounterExchange.mockReturnValue('raw encounter exchange');

    await handleEncounterTransition({ ...baseResult, resolution_triggered: 'victory' });

    const closeEncounterArg = mockPlanner.closeEncounter.mock.calls[0][0];
    expect(closeEncounterArg.encounter_summary).toBe('raw encounter exchange');
  });

  test('summarizer failure does not write summary file', async () => {
    mockSummarizer.summarize.mockRejectedValue(new Error('summarizer timed out'));

    await handleEncounterTransition({ ...baseResult, resolution_triggered: 'victory' });

    const summaryWrites = mockWriteFile.mock.calls.filter(([p]) => p.includes('_summary.md'));
    expect(summaryWrites).toHaveLength(0);
  });

  test('transition still completes after summarizer failure', async () => {
    mockSummarizer.summarize.mockRejectedValue(new Error('summarizer timed out'));

    const result = await handleEncounterTransition({ ...baseResult, resolution_triggered: 'victory' });

    expect(result.closeNarration).toBeDefined();
    expect(result.openNarration).toBeDefined();
    expect(mockNarrator.openScene).toHaveBeenCalled();
  });
});

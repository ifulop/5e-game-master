// All module mocks must be declared before the orchestrator is imported.
// We use jest.unstable_mockModule + dynamic import so Jest wires the mocks
// before index.js loads its agent dependencies.

import { jest, describe, test, expect, beforeAll, beforeEach } from '@jest/globals';

// ─── fixture data ──────────────────────────────────────────────────────────

const fixtureIntake = {
  party: [
    { name: 'Aria', class: 'Rogue', personality: 'sardonic', backstory_hook: 'guild past', playstyle_notes: 'cunning' }
  ],
  preferences: {
    tone: 'dark', primary_goal: 'conspiracy', time_available: '3h',
    combat_ratio: 0.3, problem_solving_preference: 'investigation', content_limits: []
  }
};

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
const mockIntake     = { run: jest.fn().mockResolvedValue(fixtureIntake) };
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

let processTurn, setupCampaign, handleEncounterTransition;

beforeAll(async () => {
  const mod = await import('../../index.js');
  processTurn              = mod.processTurn;
  setupCampaign            = mod.setupCampaign;
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

// ─── helpers ───────────────────────────────────────────────────────────────

function resolverWith(overrides) {
  return mockResolver.evaluate.mockResolvedValue({ ...baseResult, ...overrides });
}

// ─── Step Order Assertions ─────────────────────────────────────────────────

describe('Step Order Assertions', () => {
  test('steps execute in sequence 1→2→3→4→5→5b→6→7 when all conditions met', async () => {
    const order = [];
    resolverWith({
      object_state_changes: [{ object_id: 'obj1' }],
      revelation_triggers: ['rev1'],
      requires_narrative_update: true,
      npc_attitude_changes: [{ npc_id: 'npc1' }],
    });
    mockWriteJSON.mockImplementation(() => order.push('writeJSON'));
    mockSM.applyObjectChanges.mockImplementation(() => order.push('applyObjectChanges'));
    mockPlanner.applyRevelations.mockImplementation(() => { order.push('applyRevelations'); return Promise.resolve(); });
    mockPlanner.updateNarrativeForStateChanges.mockImplementation(() => { order.push('updateNarrative'); return Promise.resolve(); });
    mockSM.applyAttitudeChanges.mockImplementation(() => order.push('applyAttitudeChanges'));
    mockNarrator.continueTurn.mockImplementation(() => { order.push('continueTurn'); return Promise.resolve('narration'); });

    await processTurn('test input');

    expect(order.indexOf('writeJSON')).toBeLessThan(order.indexOf('applyObjectChanges'));
    expect(order.indexOf('applyObjectChanges')).toBeLessThan(order.indexOf('applyRevelations'));
    expect(order.indexOf('applyRevelations')).toBeLessThan(order.indexOf('updateNarrative'));
    expect(order.indexOf('updateNarrative')).toBeLessThan(order.indexOf('applyAttitudeChanges'));
    expect(order.indexOf('applyAttitudeChanges')).toBeLessThan(order.indexOf('continueTurn'));
  });

  test('step 5b (applyAttitudeChanges) runs before step 7 (continueTurn)', async () => {
    const order = [];
    resolverWith({ npc_attitude_changes: [{ npc_id: 'vesper' }] });
    mockSM.applyAttitudeChanges.mockImplementation(() => order.push('attitudes'));
    mockNarrator.continueTurn.mockImplementation(() => { order.push('narrator'); return Promise.resolve('narration'); });

    await processTurn('test input');

    expect(order.indexOf('attitudes')).toBeLessThan(order.indexOf('narrator'));
  });

  test('step 7 (continueTurn) is NOT called when resolution triggers', async () => {
    resolverWith({ resolution_triggered: 'victory', encounter_continues: false });
    await processTurn('test input');
    expect(mockNarrator.continueTurn).not.toHaveBeenCalled();
    expect(mockNarrator.closeEncounter).toHaveBeenCalled();
  });
});

// ─── Conditional Routing ───────────────────────────────────────────────────

describe('Conditional Routing', () => {
  test('applyRevelations NOT called when revelation_triggers is empty', async () => {
    resolverWith({ revelation_triggers: [] });
    await processTurn('test input');
    expect(mockPlanner.applyRevelations).not.toHaveBeenCalled();
  });

  test('applyRevelations IS called with trigger IDs when non-empty', async () => {
    resolverWith({ revelation_triggers: ['rev_001', 'rev_002'] });
    await processTurn('test input');
    expect(mockPlanner.applyRevelations).toHaveBeenCalledWith(['rev_001', 'rev_002']);
  });

  test('updateNarrativeForStateChanges NOT called when requires_narrative_update is false', async () => {
    resolverWith({ requires_narrative_update: false });
    await processTurn('test input');
    expect(mockPlanner.updateNarrativeForStateChanges).not.toHaveBeenCalled();
  });

  test('updateNarrativeForStateChanges IS called when requires_narrative_update is true', async () => {
    resolverWith({ requires_narrative_update: true, object_state_changes: [{ object_id: 'obj1' }] });
    await processTurn('test input');
    expect(mockPlanner.updateNarrativeForStateChanges).toHaveBeenCalled();
  });

  test('applyObjectChanges NOT called when object_state_changes is empty', async () => {
    resolverWith({ object_state_changes: [] });
    await processTurn('test input');
    expect(mockSM.applyObjectChanges).not.toHaveBeenCalled();
  });

  test('applyObjectChanges IS called when object_state_changes is non-empty', async () => {
    resolverWith({ object_state_changes: [{ object_id: 'door' }] });
    await processTurn('test input');
    expect(mockSM.applyObjectChanges).toHaveBeenCalled();
  });

  test('applyAttitudeChanges NOT called when npc_attitude_changes is empty', async () => {
    resolverWith({ npc_attitude_changes: [] });
    await processTurn('test input');
    expect(mockSM.applyAttitudeChanges).not.toHaveBeenCalled();
  });

  test('applyAttitudeChanges IS called when npc_attitude_changes is non-empty', async () => {
    resolverWith({ npc_attitude_changes: [{ npc_id: 'vesper', previous_attitude: 'cautious', new_attitude: 'frightened', reason: 'threatened' }] });
    await processTurn('test input');
    expect(mockSM.applyAttitudeChanges).toHaveBeenCalled();
  });
});

// ─── Session State Updates ─────────────────────────────────────────────────

describe('Session State Updates', () => {
  test('each processTurn call appends player input to session.player_inputs', async () => {
    await processTurn('my action');
    const writtenSession = mockWriteJSON.mock.calls.find(([p]) => p.includes('session.json'))?.[1];
    expect(writtenSession.player_inputs).toContain('my action');
  });

  test('each processTurn call increments session.turn_count', async () => {
    await processTurn('my action');
    const writtenSession = mockWriteJSON.mock.calls.find(([p]) => p.includes('session.json'))?.[1];
    expect(writtenSession.turn_count).toBe(1);
  });

  test('session.json is written after resolver.evaluate succeeds', async () => {
    const order = [];
    mockResolver.evaluate.mockImplementation(async () => {
      order.push('resolver');
      return { ...baseResult };
    });
    mockWriteJSON.mockImplementation((path) => {
      if (path.includes('session.json')) order.push('sessionWrite');
    });

    await processTurn('test input');

    expect(order.indexOf('resolver')).toBeLessThan(order.indexOf('sessionWrite'));
  });
});

// ─── Encounter Transition Routing ─────────────────────────────────────────

describe('Encounter Transition Routing', () => {
  test('handleEncounterTransition calls narrator.closeEncounter → summarizer → planner.closeEncounter → applyReconciliationBundle → planner.openNextEncounter → session reset → narrator.openScene in order', async () => {
    const order = [];
    mockNarrator.closeEncounter.mockImplementation(() => { order.push('closeEncounter'); return Promise.resolve('close'); });
    mockSummarizer.summarize.mockImplementation(() => { order.push('summarize'); return Promise.resolve('summary'); });
    mockPlanner.closeEncounter.mockImplementation(() => { order.push('plannerClose'); return Promise.resolve({}); });
    mockSM.applyReconciliationBundle.mockImplementation(() => order.push('reconcile'));
    mockPlanner.openNextEncounter.mockImplementation(() => { order.push('openNext'); return Promise.resolve(); });
    mockWriteJSON.mockImplementation((path) => { if (path.includes('session.json')) order.push('sessionReset'); });
    mockNarrator.openScene.mockImplementation(() => { order.push('openScene'); return Promise.resolve('scene'); });

    await handleEncounterTransition({ ...baseResult, resolution_triggered: 'victory' });

    expect(order.indexOf('closeEncounter')).toBeLessThan(order.indexOf('summarize'));
    expect(order.indexOf('summarize')).toBeLessThan(order.indexOf('plannerClose'));
    expect(order.indexOf('plannerClose')).toBeLessThan(order.indexOf('reconcile'));
    expect(order.indexOf('reconcile')).toBeLessThan(order.indexOf('openNext'));
    expect(order.indexOf('openNext')).toBeLessThan(order.indexOf('sessionReset'));
    expect(order.indexOf('sessionReset')).toBeLessThan(order.indexOf('openScene'));
  });

  test('narrator.closeCampaign is called (not openNextEncounter) when all encounters complete', async () => {
    // Make the campaign have only 1 encounter so nextIndex overflows
    mockReadJSON.mockImplementation((path) => {
      if (path.includes('campaign.json')) return {
        ...fixtureCampaign,
        encounters: [fixtureCampaign.encounters[0]]
      };
      if (path.includes('session.json')) return { ...baseSession };
      return {};
    });

    await handleEncounterTransition({ ...baseResult, resolution_triggered: 'victory' });

    expect(mockNarrator.closeCampaign).toHaveBeenCalled();
    expect(mockPlanner.openNextEncounter).not.toHaveBeenCalled();
  });

  test('session is reset before narrator.openScene on transition', async () => {
    const order = [];
    mockWriteJSON.mockImplementation((path, data) => {
      if (path.includes('session.json') && data.turn_count === 0) order.push('sessionReset');
    });
    mockNarrator.openScene.mockImplementation(() => { order.push('openScene'); return Promise.resolve('scene'); });

    await handleEncounterTransition({ ...baseResult, resolution_triggered: 'victory' });

    expect(order.indexOf('sessionReset')).toBeLessThan(order.indexOf('openScene'));
  });
});

// ─── Setup Phase ───────────────────────────────────────────────────────────

describe('Setup Phase', () => {
  test('setupCampaign calls intake → planner.generateCampaign → session write → narrator.openScene in order', async () => {
    const order = [];
    mockIntake.run.mockImplementation(() => { order.push('intake'); return Promise.resolve(fixtureIntake); });
    mockPlanner.generateCampaign.mockImplementation(() => { order.push('generateCampaign'); return Promise.resolve(); });
    mockWriteJSON.mockImplementation((path) => { if (path.includes('session.json')) order.push('sessionWrite'); });
    mockNarrator.openScene.mockImplementation(() => { order.push('openScene'); return Promise.resolve('scene'); });

    await setupCampaign();

    expect(order.indexOf('intake')).toBeLessThan(order.indexOf('generateCampaign'));
    expect(order.indexOf('generateCampaign')).toBeLessThan(order.indexOf('sessionWrite'));
    expect(order.indexOf('sessionWrite')).toBeLessThan(order.indexOf('openScene'));
  });

  test('session.json is written before narrator.openScene', async () => {
    const order = [];
    mockWriteJSON.mockImplementation((path) => { if (path.includes('session.json')) order.push('sessionWrite'); });
    mockNarrator.openScene.mockImplementation(() => { order.push('openScene'); return Promise.resolve('scene'); });

    await setupCampaign();

    expect(order.indexOf('sessionWrite')).toBeLessThan(order.indexOf('openScene'));
  });

  test('player files are created from intake party data without an agent call', async () => {
    await setupCampaign();

    // Player files written via writeJSON/writeFile (pure code — no extra agent calls)
    const playerStateWrites = mockWriteJSON.mock.calls.filter(([p]) => p.includes('players/'));
    const playerCardWrites  = mockWriteFile.mock.calls.filter(([p]) => p.includes('players/'));
    expect(playerStateWrites.length).toBeGreaterThan(0);
    expect(playerCardWrites.length).toBeGreaterThan(0);
    // No extra agent beyond intake, generateCampaign, openScene
    expect(mockResolver.evaluate).not.toHaveBeenCalled();
    expect(mockSummarizer.summarize).not.toHaveBeenCalled();
  });
});

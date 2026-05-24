import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { writeFileSync, readFileSync } from 'fs';

// ── helpers ───────────────────────────────────────────────────────────────────

let tmpDir;

function writeTmp(relPath, data) {
  const full = join(tmpDir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  writeFileSync(full, content, 'utf8');
}

function readTmpJSON(relPath) {
  return JSON.parse(readFileSync(join(tmpDir, relPath), 'utf8'));
}

function readTmpText(relPath) {
  return readFileSync(join(tmpDir, relPath), 'utf8');
}

// ── fixture data ──────────────────────────────────────────────────────────────

const fixtureSession = {
  campaign_id: 'test-001',
  current_encounter_index: 1,
  current_encounter_id: 'enc_002',
  encounter_status: 'in_progress',
  turn_count: 4,
  player_inputs: ['We approach cautiously'],
};

const fixtureLocationState = {
  location_id: 'pier_9_wharf',
  first_appeared: 'enc_002',
  times_visited: 1,
  last_visited: 'enc_002',
  atmosphere_tags: ['dark', 'isolated'],
  objects: [
    {
      id: 'harbormaster_door',
      label: "Harbormaster's office door",
      initial_state: 'locked',
      current_state: 'locked',
      interacted_by: null,
      interaction: null,
      encounter: null,
      planner_flag: null,
    },
    {
      id: 'fish_crates',
      label: 'Stack of fish crates',
      initial_state: 'neatly stacked',
      current_state: 'neatly stacked',
      interacted_by: null,
      interaction: null,
      encounter: null,
      planner_flag: null,
    },
  ],
  npcs_associated: ['vesper'],
  encounter_history: ['enc_002'],
  world_state_flags: {},
};

const fixtureNPCState = {
  npc_id: 'vesper',
  first_appeared: 'enc_002',
  current_attitude: 'cautious',
  attitude_history: [],
  knowledge_revealed: ['knows_about_ledger_payments'],
  knowledge_locked: ['warden_identity', 'secondary_ledger_location'],
  alive: true,
  location: 'unknown',
  will_reappear: true,
};

const fixturePlayerState = {
  player_id: 'aria',
  class: 'rogue',
  behavioral_tags: ['prefers_deception'],
  relationships: {},
  knowledge: ['ledger_guard_connection'],
  planner_flags: [],
};

const fixtureCampaign = {
  meta: { campaign_id: 'test-001' },
  encounters: [
    {
      id: 'enc_001',
      index: 0,
      revelation_conditions: [
        { id: 'tavern_ledger_found', condition: 'search tavern', reveals: '...', triggered: false },
      ],
      resolution_conditions: {
        victory: { condition: 'escape with ledger', triggered: false },
        failure:  { condition: 'flee', triggered: false },
        partial:  { condition: 'escape without ledger', triggered: false },
      },
    },
    {
      id: 'enc_002',
      index: 1,
      revelation_conditions: [
        { id: 'vesper_warden_hint', condition: 'offer protection', reveals: '...', triggered: false },
        { id: 'enc_002_transition', condition: 'victory', reveals: '...', triggered: false },
      ],
      resolution_conditions: {
        victory: { condition: 'learn about Collen', triggered: false },
        failure:  { condition: 'Vesper flees', triggered: false },
        partial:  { condition: 'docks connection', triggered: false },
      },
    },
  ],
  progress: {
    current_encounter_index: 1,
    current_encounter_id: 'enc_002',
    revealed_plot_threads: ['enc_001_ledger_clue'],
    unrevealed_plot_threads: ['shadow_council'],
  },
  world_state: {
    flags: { magistrate_alerted: false },
  },
};

// ── setup / teardown ──────────────────────────────────────────────────────────

let StateManager;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'sm-test-'));
  const mod = await import(`../../stateManager.js?t=${Date.now()}`);
  StateManager = mod.StateManager;
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  // Reset all fixture files before each test
  writeTmp('session.json', fixtureSession);
  writeTmp('campaign.json', fixtureCampaign);
  writeTmp('locations/pier_9_wharf/pier_9_wharf_state.json', fixtureLocationState);
  writeTmp('npcs/vesper/vesper_state.json', fixtureNPCState);
  writeTmp('npcs/vesper/vesper_narrator.md', '# Vesper\n\nA cautious informant.');
  writeTmp('players/aria/aria_state.json', fixturePlayerState);
  writeTmp('players/aria/aria_narrator.md', '# Aria\n\nA sardonic rogue.');
  writeTmp('locations/pier_9_wharf/pier_9_wharf_narrator.md', '# Pier 9 Wharf\n\nA dark, isolated wharf.');
});

function sm() {
  return new StateManager(tmpDir);
}

// ── 2.1 applyObjectChanges ────────────────────────────────────────────────────

describe('applyObjectChanges', () => {
  test('updates current_state, interacted_by, interaction, and encounter on matching object', () => {
    sm().applyObjectChanges([{
      location: 'pier_9_wharf',
      object_id: 'fish_crates',
      new_state: 'disturbed',
      interacted_by: 'party',
      interaction: 'concealed behind during guard patrol',
    }]);

    const state = readTmpJSON('locations/pier_9_wharf/pier_9_wharf_state.json');
    const obj   = state.objects.find(o => o.id === 'fish_crates');
    expect(obj.current_state).toBe('disturbed');
    expect(obj.interacted_by).toBe('party');
    expect(obj.interaction).toBe('concealed behind during guard patrol');
    expect(obj.encounter).toBe('enc_002');
  });

  test('leaves other objects in the same location unchanged', () => {
    sm().applyObjectChanges([{
      location: 'pier_9_wharf',
      object_id: 'fish_crates',
      new_state: 'disturbed',
      interacted_by: 'party',
      interaction: 'test',
    }]);

    const state = readTmpJSON('locations/pier_9_wharf/pier_9_wharf_state.json');
    const door  = state.objects.find(o => o.id === 'harbormaster_door');
    expect(door.current_state).toBe('locked');
    expect(door.interacted_by).toBe(null);
  });

  test('applies multiple changes to the same location in one write', () => {
    sm().applyObjectChanges([
      { location: 'pier_9_wharf', object_id: 'harbormaster_door', new_state: 'ajar',      interacted_by: 'aria',  interaction: 'lockpicked' },
      { location: 'pier_9_wharf', object_id: 'fish_crates',       new_state: 'disturbed', interacted_by: 'party', interaction: 'hidden behind' },
    ]);

    const state = readTmpJSON('locations/pier_9_wharf/pier_9_wharf_state.json');
    expect(state.objects.find(o => o.id === 'harbormaster_door').current_state).toBe('ajar');
    expect(state.objects.find(o => o.id === 'fish_crates').current_state).toBe('disturbed');
  });

  test('silently skips unknown object_id', () => {
    expect(() => sm().applyObjectChanges([{
      location: 'pier_9_wharf',
      object_id: 'nonexistent_object',
      new_state: 'broken',
      interacted_by: 'aria',
      interaction: 'smashed',
    }])).not.toThrow();
  });
});

// ── 2.2 applyNPCAttitudeChange / applyAttitudeChanges ─────────────────────────

describe('applyNPCAttitudeChange', () => {
  test('updates current_attitude in npc_state.json', () => {
    sm().applyNPCAttitudeChange('vesper', 'frightened', 'enc_002', 4);
    const state = readTmpJSON('npcs/vesper/vesper_state.json');
    expect(state.current_attitude).toBe('frightened');
  });

  test('appends entry to attitude_history', () => {
    sm().applyNPCAttitudeChange('vesper', 'frightened', 'enc_002', 4);
    const state = readTmpJSON('npcs/vesper/vesper_state.json');
    expect(state.attitude_history).toHaveLength(1);
    expect(state.attitude_history[0]).toEqual({ encounter: 'enc_002', turn: 4, attitude: 'frightened' });
  });
});

describe('applyAttitudeChanges', () => {
  const changes = [{
    npc_id: 'vesper',
    previous_attitude: 'cautious',
    new_attitude: 'frightened',
    reason: 'Party pressed her for the Warden\'s name',
  }];

  test('updates npc_state.json current_attitude', () => {
    sm().applyAttitudeChanges(changes);
    expect(readTmpJSON('npcs/vesper/vesper_state.json').current_attitude).toBe('frightened');
  });

  test('appends attitude-shift note to npc_narrator.md', () => {
    sm().applyAttitudeChanges(changes);
    const content = readTmpText('npcs/vesper/vesper_narrator.md');
    expect(content).toContain('## Attitude shift — Turn 4');
    expect(content).toContain('vesper: cautious → frightened');
    expect(content).toContain("Party pressed her for the Warden's name");
  });

  test('attitude note appears after existing narrator content', () => {
    sm().applyAttitudeChanges(changes);
    const content = readTmpText('npcs/vesper/vesper_narrator.md');
    expect(content.indexOf('# Vesper')).toBeLessThan(content.indexOf('Attitude shift'));
  });

  test('processes multiple NPC changes in one call', () => {
    // Add a second NPC
    writeTmp('npcs/guard/guard_state.json', {
      npc_id: 'guard',
      first_appeared: 'enc_001',
      current_attitude: 'neutral',
      attitude_history: [],
      knowledge_revealed: [],
      knowledge_locked: [],
      alive: true,
      location: 'unknown',
      will_reappear: false,
    });
    writeTmp('npcs/guard/guard_narrator.md', '# Guard\n\nA city guard.');

    sm().applyAttitudeChanges([
      ...changes,
      { npc_id: 'guard', previous_attitude: 'neutral', new_attitude: 'hostile', reason: 'spotted the party' },
    ]);

    expect(readTmpJSON('npcs/vesper/vesper_state.json').current_attitude).toBe('frightened');
    expect(readTmpJSON('npcs/guard/guard_state.json').current_attitude).toBe('hostile');
  });
});

// ── 2.3 Player state operations ───────────────────────────────────────────────

describe('applyPlayerKnowledgeUpdate', () => {
  test('appends new knowledge item to knowledge array', () => {
    sm().applyPlayerKnowledgeUpdate('aria', 'vesper_docks_link');
    const state = readTmpJSON('players/aria/aria_state.json');
    expect(state.knowledge).toContain('vesper_docks_link');
    expect(state.knowledge).toContain('ledger_guard_connection'); // existing item preserved
  });

  test('allows duplicate knowledge entries (dedup is caller responsibility)', () => {
    sm().applyPlayerKnowledgeUpdate('aria', 'ledger_guard_connection');
    const state = readTmpJSON('players/aria/aria_state.json');
    expect(state.knowledge.filter(k => k === 'ledger_guard_connection')).toHaveLength(2);
  });
});

describe('applyPlayerBehavioralTag', () => {
  test('adds new tag to behavioral_tags', () => {
    sm().applyPlayerBehavioralTag('aria', 'shows_mercy_to_frightened_npcs');
    expect(readTmpJSON('players/aria/aria_state.json').behavioral_tags)
      .toContain('shows_mercy_to_frightened_npcs');
  });

  test('does not duplicate an existing tag', () => {
    sm().applyPlayerBehavioralTag('aria', 'prefers_deception');
    const tags = readTmpJSON('players/aria/aria_state.json').behavioral_tags;
    expect(tags.filter(t => t === 'prefers_deception')).toHaveLength(1);
  });

  test('preserves other existing tags when adding a new one', () => {
    sm().applyPlayerBehavioralTag('aria', 'new_tag');
    const tags = readTmpJSON('players/aria/aria_state.json').behavioral_tags;
    expect(tags).toContain('prefers_deception');
    expect(tags).toContain('new_tag');
  });
});

// ── 2.4 applyReconciliationBundle ─────────────────────────────────────────────

const fixtureBundle = {
  npc_updates: [{
    npc_id: 'vesper',
    encounter: 'enc_002',
    new_attitude: 'cooperative',
    knowledge_newly_revealed: ['warden_identity'],
    narrator_card_append: 'Vesper warmed to the party and shared what she knew about The Warden.',
  }],
  player_updates: [{
    player_id: 'aria',
    new_behavioral_tags: ['shows_mercy_to_frightened_npcs', 'prefers_deception'], // second is a dupe
    new_knowledge: ['vesper_docks_link', 'warden_referenced'],
    narrator_card_append: 'Aria held back from pressing Vesper and now holds the gala invitation.',
  }],
  location_updates: [{
    location_id: 'pier_9_wharf',
    object_changes: [{
      location: 'pier_9_wharf',
      object_id: 'harbormaster_door',
      new_state: 'relocked',
      interacted_by: 'aria',
      interaction: 'relocked on exit to conceal breach',
    }],
    narrator_card_append: 'The wharf was left as found. The door was relocked.',
  }],
  campaign_updates: {
    world_state: { flags: { players_know_about_warden: true } },
    progress: {
      current_encounter_id: 'enc_003',
      revealed_plot_threads: ['warden_referenced'],
    },
    conditions_triggered: ['vesper_warden_hint', 'enc_002_transition'],
  },
};

describe('applyReconciliationBundle', () => {
  test('updates NPC attitude and knowledge', () => {
    sm().applyReconciliationBundle(fixtureBundle);
    const npc = readTmpJSON('npcs/vesper/vesper_state.json');
    expect(npc.current_attitude).toBe('cooperative');
    expect(npc.knowledge_revealed).toContain('warden_identity');
    expect(npc.knowledge_locked).not.toContain('warden_identity');
  });

  test('appends to NPC narrator card', () => {
    sm().applyReconciliationBundle(fixtureBundle);
    expect(readTmpText('npcs/vesper/vesper_narrator.md'))
      .toContain('Vesper warmed to the party');
  });

  test('adds new player behavioral tags (deduplicates existing)', () => {
    sm().applyReconciliationBundle(fixtureBundle);
    const tags = readTmpJSON('players/aria/aria_state.json').behavioral_tags;
    expect(tags).toContain('shows_mercy_to_frightened_npcs');
    expect(tags.filter(t => t === 'prefers_deception')).toHaveLength(1);
  });

  test('adds new player knowledge (deduplicates existing)', () => {
    sm().applyReconciliationBundle(fixtureBundle);
    const knowledge = readTmpJSON('players/aria/aria_state.json').knowledge;
    expect(knowledge).toContain('vesper_docks_link');
    expect(knowledge).toContain('warden_referenced');
    expect(knowledge.filter(k => k === 'ledger_guard_connection')).toHaveLength(1);
  });

  test('appends to player narrator card', () => {
    sm().applyReconciliationBundle(fixtureBundle);
    expect(readTmpText('players/aria/aria_narrator.md'))
      .toContain('holds the gala invitation');
  });

  test('applies location object changes', () => {
    sm().applyReconciliationBundle(fixtureBundle);
    const loc = readTmpJSON('locations/pier_9_wharf/pier_9_wharf_state.json');
    const door = loc.objects.find(o => o.id === 'harbormaster_door');
    expect(door.current_state).toBe('relocked');
    expect(door.interacted_by).toBe('aria');
  });

  test('appends to location narrator card', () => {
    sm().applyReconciliationBundle(fixtureBundle);
    expect(readTmpText('locations/pier_9_wharf/pier_9_wharf_narrator.md'))
      .toContain('The wharf was left as found');
  });

  test('merges world_state flags without clobbering existing flags', () => {
    sm().applyReconciliationBundle(fixtureBundle);
    const campaign = readTmpJSON('campaign.json');
    expect(campaign.world_state.flags.players_know_about_warden).toBe(true);
    expect(campaign.world_state.flags.magistrate_alerted).toBe(false); // existing preserved
  });

  test('updates campaign progress fields', () => {
    sm().applyReconciliationBundle(fixtureBundle);
    const campaign = readTmpJSON('campaign.json');
    expect(campaign.progress.current_encounter_id).toBe('enc_003');
  });

  test('union-merges array progress fields', () => {
    sm().applyReconciliationBundle(fixtureBundle);
    const campaign = readTmpJSON('campaign.json');
    expect(campaign.progress.revealed_plot_threads).toContain('enc_001_ledger_clue'); // existing
    expect(campaign.progress.revealed_plot_threads).toContain('warden_referenced');   // new
  });

  test('marks triggered revelation conditions in campaign.json', () => {
    sm().applyReconciliationBundle(fixtureBundle);
    const campaign = readTmpJSON('campaign.json');
    const enc002   = campaign.encounters.find(e => e.id === 'enc_002');
    expect(enc002.revelation_conditions.find(c => c.id === 'vesper_warden_hint').triggered).toBe(true);
    expect(enc002.revelation_conditions.find(c => c.id === 'enc_002_transition').triggered).toBe(true);
  });

  test('does not mark unrelated conditions as triggered', () => {
    sm().applyReconciliationBundle(fixtureBundle);
    const campaign = readTmpJSON('campaign.json');
    const enc001   = campaign.encounters.find(e => e.id === 'enc_001');
    expect(enc001.revelation_conditions.find(c => c.id === 'tavern_ledger_found').triggered).toBe(false);
  });

  test('handles empty bundle without throwing', () => {
    expect(() => sm().applyReconciliationBundle({})).not.toThrow();
  });

  test('handles bundle with empty arrays without throwing', () => {
    expect(() => sm().applyReconciliationBundle({
      npc_updates: [], player_updates: [], location_updates: [], campaign_updates: {},
    })).not.toThrow();
  });
});

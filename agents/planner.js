import { writeJSON } from '../fileUtils.js';

const CAMPAIGN_DIR = process.env.CAMPAIGN_DIR ?? 'campaign';

export async function generateCampaign(intakeData) {
  console.log('[STUB] planner.generateCampaign called');
  writeJSON(`${CAMPAIGN_DIR}/campaign.json`, {
    meta: { campaign_id: 'stub-campaign-001', title: 'Stub Campaign' },
    encounters: [
      {
        id: 'enc_001',
        index: 0,
        title: 'First Encounter',
        status: 'current',
        outcome: null,
        location_id: 'loc_001',
        npcs: [],
        revelation_conditions: [],
        resolution_conditions: {
          victory: { condition: 'stub victory condition', triggered: false },
          failure: { condition: 'stub failure condition', triggered: false },
          partial: { condition: 'stub partial condition', triggered: false }
        }
      },
      {
        id: 'enc_002',
        index: 1,
        title: 'Second Encounter',
        status: 'upcoming',
        outcome: null,
        location_id: 'loc_001',
        npcs: [],
        revelation_conditions: [],
        resolution_conditions: {
          victory: { condition: 'stub victory condition', triggered: false },
          failure: { condition: 'stub failure condition', triggered: false },
          partial: { condition: 'stub partial condition', triggered: false }
        }
      }
    ],
    location_secrets: {},
    progress: { current_encounter_index: 0, current_encounter_id: 'enc_001', revealed_plot_threads: [] },
    world_state: { flags: {} }
  });
}

export async function applyRevelations(triggers) {
  console.log('[STUB] planner.applyRevelations called', triggers);
}

export async function updateNarrativeForStateChanges(changes) {
  console.log('[STUB] planner.updateNarrativeForStateChanges called');
}

export async function closeEncounter(params) {
  console.log('[STUB] planner.closeEncounter called');
  return {
    npc_updates: [],
    player_updates: [],
    location_updates: [],
    campaign_updates: {}
  };
}

export async function openNextEncounter(params) {
  console.log('[STUB] planner.openNextEncounter called');
}

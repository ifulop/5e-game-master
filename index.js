import { existsSync } from 'fs';
import { readJSON, writeJSON, writeFile, getEncounterExchange } from './fileUtils.js';
import * as intake from './agents/intake.js';
import * as planner from './agents/planner.js';
import * as resolver from './agents/resolver.js';
import * as narrator from './agents/narrator.js';
import * as summarizer from './agents/summarizer.js';
import { StateManager } from './stateManager.js';

const CAMPAIGN_DIR = process.env.CAMPAIGN_DIR ?? 'campaign';
const stateManager = new StateManager(CAMPAIGN_DIR);

export async function setupCampaign() {
  const intakeData = await intake.run();
  writeJSON(`${CAMPAIGN_DIR}/intake.json`, intakeData);

  await planner.generateCampaign(intakeData);

  const campaign = readJSON(`${CAMPAIGN_DIR}/campaign.json`);
  const session = {
    campaign_id: campaign.meta.campaign_id,
    current_encounter_index: 0,
    current_encounter_id: campaign.encounters[0].id,
    encounter_status: 'awaiting_scene_open',
    turn_count: 0,
    player_inputs: []
  };
  writeJSON(`${CAMPAIGN_DIR}/session.json`, session);

  for (const player of intakeData.party) {
    createPlayerFiles(player);
  }

  const narration = await narrator.openScene();
  session.encounter_status = 'in_progress';
  writeJSON(`${CAMPAIGN_DIR}/session.json`, session);
  return narration;
}

export async function processTurn(playerInput) {
  // ── Step 1: Update session state ─────────────────────────────────────────
  const session = readJSON(`${CAMPAIGN_DIR}/session.json`);
  session.player_inputs.push(playerInput);
  session.turn_count++;
  writeJSON(`${CAMPAIGN_DIR}/session.json`, session);

  // ── Step 2: Resolver ──────────────────────────────────────────────────────
  const campaign = readJSON(`${CAMPAIGN_DIR}/campaign.json`);
  const currentEncounter = campaign.encounters[session.current_encounter_index];
  const result = await resolver.evaluate({
    input: playerInput,
    accumulated_inputs: session.player_inputs,
    revelation_conditions: currentEncounter.revelation_conditions,
    resolution_conditions: currentEncounter.resolution_conditions,
    location_secrets: campaign.location_secrets?.[currentEncounter.location_id] ?? null,
    npc_attitudes: getActiveNPCAttitudes(currentEncounter)
  });
  writeJSON(`${CAMPAIGN_DIR}/resolver_result.json`, result);

  // ── Step 3: Object state changes ──────────────────────────────────────────
  if (result.object_state_changes.length > 0) {
    stateManager.applyObjectChanges(result.object_state_changes);
  }

  // ── Step 4: Revelation append ─────────────────────────────────────────────
  if (result.revelation_triggers.length > 0) {
    await planner.applyRevelations(result.revelation_triggers);
  }

  // ── Step 5: Narrative update for object state changes ─────────────────────
  if (result.requires_narrative_update) {
    await planner.updateNarrativeForStateChanges(result.object_state_changes);
  }

  // ── Step 5b: NPC attitude changes — must run before narrator ──────────────
  if (result.npc_attitude_changes.length > 0) {
    stateManager.applyAttitudeChanges(result.npc_attitude_changes);
  }

  // ── Step 6: Encounter resolution ─────────────────────────────────────────
  if (result.resolution_triggered) {
    return await handleEncounterTransition(result);
  }

  // ── Step 7: Narrator ──────────────────────────────────────────────────────
  const narration = await narrator.continueTurn(playerInput);
  return narration;
}

export async function handleEncounterTransition(resolverResult) {
  const session = readJSON(`${CAMPAIGN_DIR}/session.json`);
  const campaign = readJSON(`${CAMPAIGN_DIR}/campaign.json`);

  // ── Step 1: Narrator closes current encounter ─────────────────────────────
  const closeNarration = await narrator.closeEncounter(resolverResult);

  // ── Step 2: Summarizer ────────────────────────────────────────────────────
  const summary = await summarizer.summarize({
    encounter_exchange: getEncounterExchange(session),
    resolution: resolverResult
  });
  writeFile(`${CAMPAIGN_DIR}/encounters/${session.current_encounter_id}_summary.md`, summary);

  // ── Step 3: Planner reconciliation ────────────────────────────────────────
  const updates = await planner.closeEncounter({
    encounter_summary: summary,
    resolver_result: resolverResult
  });

  // ── Step 4: Apply reconciliation bundle ───────────────────────────────────
  stateManager.applyReconciliationBundle(updates);

  // ── Step 5: Check campaign complete ──────────────────────────────────────
  const nextIndex = session.current_encounter_index + 1;
  if (nextIndex >= campaign.encounters.length) {
    const openNarration = await narrator.closeCampaign();
    return { closeNarration, openNarration };
  }

  // ── Step 6: Planner opens next encounter ──────────────────────────────────
  await planner.openNextEncounter({
    completed_summary: summary,
    next_encounter: campaign.encounters[nextIndex],
    player_states: getAllPlayerStates(),
    campaign_progress: campaign.progress
  });

  // ── Step 7: Reset session for new encounter ───────────────────────────────
  session.current_encounter_index = nextIndex;
  session.current_encounter_id = campaign.encounters[nextIndex].id;
  session.encounter_status = 'awaiting_scene_open';
  session.turn_count = 0;
  session.player_inputs = [];
  writeJSON(`${CAMPAIGN_DIR}/session.json`, session);

  // ── Step 8: Narrator opens new scene ─────────────────────────────────────
  const openNarration = await narrator.openScene();
  session.encounter_status = 'in_progress';
  writeJSON(`${CAMPAIGN_DIR}/session.json`, session);
  return { closeNarration, openNarration };
}

function createPlayerFiles(player) {
  const id = player.name.toLowerCase();
  const narratorCard = [
    `# ${player.name}`,
    ``,
    `**Class:** ${player.class}`,
    `**Personality:** ${player.personality}`,
    `**Backstory:** ${player.backstory_hook}`,
    `**Playstyle:** ${player.playstyle_notes}`,
  ].join('\n');
  const state = {
    player_id: id,
    class: player.class.toLowerCase(),
    behavioral_tags: [],
    relationships: {},
    knowledge: [],
    planner_flags: []
  };
  writeFile(`${CAMPAIGN_DIR}/players/${id}/${id}_narrator.md`, narratorCard);
  writeJSON(`${CAMPAIGN_DIR}/players/${id}/${id}_state.json`, state);
}

function getActiveNPCAttitudes(encounter) {
  if (!encounter.npcs?.length) return {};
  const attitudes = {};
  for (const npcId of encounter.npcs) {
    const statePath = `${CAMPAIGN_DIR}/npcs/${npcId}/${npcId}_state.json`;
    if (existsSync(statePath)) {
      const state = readJSON(statePath);
      attitudes[npcId] = state.current_attitude;
    }
  }
  return attitudes;
}

function getAllPlayerStates() {
  return [];
}

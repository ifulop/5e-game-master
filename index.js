import { existsSync } from 'fs';
import { readJSON, writeJSON, writeFile, appendToFile, getEncounterExchange } from './fileUtils.js';
import * as intake from './agents/intake.js';
import * as planner from './agents/planner.js';
import * as resolver from './agents/resolver.js';
import * as narrator from './agents/narrator.js';
import * as summarizer from './agents/summarizer.js';
import { StateManager } from './stateManager.js';

function campaignDir() { return process.env.CAMPAIGN_DIR ?? 'campaigns/default'; }

function logTranscript(text) {
  appendToFile(`${campaignDir()}/adventure_transcript.md`, text);
}

// providedIntake: used by HTTP flow where intake was already completed via /intake endpoint
export async function setupCampaign(providedIntake = null) {
  const dir = campaignDir();
  let intakeData;
  if (providedIntake) {
    intakeData = providedIntake;
  } else {
    intakeData = await intake.run();
    writeJSON(`${dir}/intake.json`, intakeData);
  }

  await planner.generateCampaign(intakeData);

  const campaign = readJSON(`${dir}/campaign.json`);
  initMissingLocationStates(campaign, dir);
  initMissingNPCStates(campaign, dir);
  const firstEnc = campaign.encounters[0];
  const session = {
    campaign_id: campaign.meta.campaign_id,
    current_encounter_index: 0,
    current_encounter_id: firstEnc.id,
    current_encounter_npcs: firstEnc.npcs ?? [],
    current_encounter_location_id: firstEnc.location_id ?? null,
    prev_encounter_id: null,
    encounter_ids: campaign.encounters.map(e => e.id),
    encounter_status: 'awaiting_scene_open',
    turn_count: 0,
    player_inputs: []
  };
  writeJSON(`${dir}/session.json`, session);

  for (const player of intakeData.party) {
    createPlayerFiles(player, dir);
  }

  const narration = await narrator.openScene();
  session.encounter_status = 'in_progress';
  writeJSON(`${dir}/session.json`, session);

  logTranscript(`# Adventure Transcript\n\n## Opening Scene\n\n${narration}\n\n---\n\n`);
  return narration;
}

export async function processTurn(playerInput) {
  const dir = campaignDir();
  const sm = new StateManager(dir);

  // ── Step 1: Load session (no write yet — turn is not consumed until resolver succeeds) ──
  const session = readJSON(`${dir}/session.json`);

  // ── Step 1b: Retry pending revelation triggers from a previous failed append ──
  if (session.pending_revelation_triggers?.length) {
    try {
      await planner.applyRevelations(session.pending_revelation_triggers);
      delete session.pending_revelation_triggers;
      writeJSON(`${dir}/session.json`, session);
    } catch {
      // Leave triggers for retry next turn; continue with current turn
    }
  }

  // ── Step 2: Resolver ──────────────────────────────────────────────────────
  const campaign = readJSON(`${dir}/campaign.json`);
  const currentEncounter = campaign.encounters[session.current_encounter_index];

  // Compute the would-be updated values to pass to the resolver
  const newInputs = [...session.player_inputs, playerInput];
  const newTurnCount = session.turn_count + 1;

  const result = await resolver.evaluate({
    input: playerInput,
    accumulated_inputs: newInputs,
    revelation_conditions: currentEncounter.revelation_conditions,
    resolution_conditions: currentEncounter.resolution_conditions,
    location_secrets: campaign.location_secrets?.[currentEncounter.location_id] ?? null,
    npc_attitudes: getActiveNPCAttitudes(currentEncounter, dir),
    encounter_id: session.current_encounter_id,
    turn: newTurnCount,
  });

  // ── Write session AFTER resolver succeeds (turn is now consumed) ──────────
  session.player_inputs = newInputs;
  session.turn_count = newTurnCount;
  writeJSON(`${dir}/session.json`, session);
  writeJSON(`${dir}/resolver_result.json`, result);

  // ── Step 3: Object state changes ──────────────────────────────────────────
  if (result.object_state_changes.length > 0) {
    sm.applyObjectChanges(result.object_state_changes);
  }

  // ── Step 4: Revelation append ─────────────────────────────────────────────
  if (result.revelation_triggers.length > 0) {
    try {
      await planner.applyRevelations(result.revelation_triggers);
    } catch {
      // Narrator will run without the new REVEALED content this turn; retry next turn
      session.pending_revelation_triggers = [
        ...(session.pending_revelation_triggers ?? []),
        ...result.revelation_triggers,
      ];
      writeJSON(`${dir}/session.json`, session);
    }
  }

  // ── Step 5: Narrative update for object state changes ─────────────────────
  if (result.requires_narrative_update) {
    await planner.updateNarrativeForStateChanges(result.object_state_changes);
  }

  // ── Step 5b: NPC attitude changes — must run before narrator ──────────────
  if (result.npc_attitude_changes.length > 0) {
    sm.applyAttitudeChanges(result.npc_attitude_changes);
  }

  // ── Step 6: Narrator ─────────────────────────────────────────────────────
  // Always narrate the player's action first — including the turn that triggers resolution
  const narration = await narrator.continueTurn(playerInput);
  logTranscript(`**Player:** ${playerInput}\n\n${narration}\n\n---\n\n`);

  // ── Step 7: Encounter resolution ─────────────────────────────────────────
  if (result.resolution_triggered) {
    await handleEncounterTransition(result);
    const updatedSession = readJSON(`${dir}/session.json`);
    return {
      narration,
      encounter_resolved: true,
      resolution_type: result.resolution_triggered,
      campaign_complete: updatedSession.encounter_status === 'complete',
    };
  }

  return narration;
}

export async function handleEncounterTransition(resolverResult) {
  const dir = campaignDir();
  const sm = new StateManager(dir);
  const session = readJSON(`${dir}/session.json`);
  const campaign = readJSON(`${dir}/campaign.json`);

  // ── Step 1: Summarizer — fallback to raw exchange on failure ─────────────
  let summary;
  try {
    summary = await summarizer.summarize({
      encounter_exchange: getEncounterExchange(session),
      resolution: resolverResult
    });
    writeFile(`${dir}/encounters/${session.current_encounter_id}_summary.md`, summary);
  } catch {
    summary = getEncounterExchange(session);
  }

  // ── Step 2: Planner reconciliation ────────────────────────────────────────
  const updates = await planner.closeEncounter({
    encounter_summary: summary,
    resolver_result: resolverResult
  });

  // ── Step 3: Apply reconciliation bundle ───────────────────────────────────
  sm.applyReconciliationBundle(updates);

  // ── Step 4: Check campaign complete ───────────────────────────────────────
  const nextIndex = session.current_encounter_index + 1;
  if (nextIndex >= campaign.encounters.length) {
    session.encounter_status = 'complete';
    writeJSON(`${dir}/session.json`, session);
    return;
  }

  // ── Step 5: Planner opens next encounter ──────────────────────────────────
  await planner.openNextEncounter({
    completed_summary: summary,
    next_encounter: campaign.encounters[nextIndex],
    player_states: getAllPlayerStates(dir),
    campaign_progress: campaign.progress
  });

  // ── Step 6: Reset session for next encounter ──────────────────────────────
  const nextEnc = campaign.encounters[nextIndex];
  session.prev_encounter_id = session.current_encounter_id;
  session.current_encounter_index = nextIndex;
  session.current_encounter_id = nextEnc.id;
  session.current_encounter_npcs = nextEnc.npcs ?? [];
  session.current_encounter_location_id = nextEnc.location_id ?? null;
  session.encounter_status = 'awaiting_scene_open';
  session.turn_count = 0;
  session.player_inputs = [];
  writeJSON(`${dir}/session.json`, session);
}

function createPlayerFiles(player, dir) {
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
  writeFile(`${dir}/players/${id}/${id}_narrator.md`, narratorCard);
  writeJSON(`${dir}/players/${id}/${id}_state.json`, state);
}

function initMissingNPCStates(campaign, dir) {
  const npcIds = new Set(
    campaign.encounters.flatMap(e => e.npcs ?? [])
  );
  for (const npcId of npcIds) {
    const statePath = `${dir}/npcs/${npcId}/${npcId}_state.json`;
    if (!existsSync(statePath)) {
      const firstEnc = campaign.encounters.find(e => e.npcs?.includes(npcId));
      writeJSON(statePath, {
        npc_id: npcId,
        first_appeared: firstEnc?.id ?? null,
        current_attitude: 'neutral',
        attitude_history: [],
        knowledge_revealed: [],
        knowledge_locked: [],
        alive: true,
        location: firstEnc?.location_id ?? null,
        will_reappear: false,
        scheduled_reappearance: null
      });
    }
  }
}

function initMissingLocationStates(campaign, dir) {
  const locationIds = new Set(
    campaign.encounters.map(e => e.location_id).filter(Boolean)
  );
  for (const locId of locationIds) {
    const statePath = `${dir}/locations/${locId}/${locId}_state.json`;
    if (!existsSync(statePath)) {
      writeJSON(statePath, {
        location_id: locId,
        first_appeared: campaign.encounters.find(e => e.location_id === locId)?.id ?? null,
        times_visited: 0,
        last_visited: null,
        atmosphere_tags: [],
        objects: [],
        npcs_associated: [],
        encounter_history: [],
        world_state_flags: {}
      });
    }
  }
}

function getActiveNPCAttitudes(encounter, dir) {
  if (!encounter.npcs?.length) return {};
  const attitudes = {};
  for (const npcId of encounter.npcs) {
    const statePath = `${dir}/npcs/${npcId}/${npcId}_state.json`;
    if (existsSync(statePath)) {
      const state = readJSON(statePath);
      attitudes[npcId] = state.current_attitude;
    }
  }
  return attitudes;
}

function getAllPlayerStates(dir) {
  return [];
}

import { readJSON, writeJSON, appendToFile } from './fileUtils.js';

export class StateManager {
  constructor(campaignDir = 'campaign') {
    this._dir = campaignDir;
  }

  // ── Path helpers ────────────────────────────────────────────────────────────

  _sessionPath()                  { return `${this._dir}/session.json`; }
  _campaignPath()                 { return `${this._dir}/campaign.json`; }
  _npcStatePath(id)               { return `${this._dir}/npcs/${id}/${id}_state.json`; }
  _npcNarratorPath(id)            { return `${this._dir}/npcs/${id}/${id}_narrator.md`; }
  _playerStatePath(id)            { return `${this._dir}/players/${id}/${id}_state.json`; }
  _playerNarratorPath(id)         { return `${this._dir}/players/${id}/${id}_narrator.md`; }
  _locationStatePath(id)          { return `${this._dir}/locations/${id}/${id}_state.json`; }
  _locationNarratorPath(id)       { return `${this._dir}/locations/${id}/${id}_narrator.md`; }

  // ── 2.1 Object state ────────────────────────────────────────────────────────

  applyObjectChanges(changes) {
    const session = readJSON(this._sessionPath());

    // Group by location so we only read/write each location_state.json once
    const byLocation = {};
    for (const change of changes) {
      (byLocation[change.location] ??= []).push(change);
    }

    for (const [locationId, locationChanges] of Object.entries(byLocation)) {
      const path  = this._locationStatePath(locationId);
      const state = readJSON(path);
      for (const change of locationChanges) {
        const obj = state.objects.find(o => o.id === change.object_id);
        if (!obj) continue;
        obj.current_state  = change.new_state;
        obj.interacted_by  = change.interacted_by;
        obj.interaction    = change.interaction;
        obj.encounter      = session.current_encounter_id;
      }
      writeJSON(path, state);
    }
  }

  // ── 2.2 NPC attitude ────────────────────────────────────────────────────────

  applyNPCAttitudeChange(npcId, newAttitude, encounter, turn) {
    const path  = this._npcStatePath(npcId);
    const state = readJSON(path);
    state.current_attitude = newAttitude;
    state.attitude_history.push({ encounter, turn, attitude: newAttitude });
    writeJSON(path, state);
  }

  applyAttitudeChanges(changes) {
    const session = readJSON(this._sessionPath());
    for (const change of changes) {
      this.applyNPCAttitudeChange(
        change.npc_id,
        change.new_attitude,
        session.current_encounter_id,
        session.turn_count
      );
      const note = [
        '',
        '---',
        `## Attitude shift — Turn ${session.turn_count}`,
        `${change.npc_id}: ${change.previous_attitude} → ${change.new_attitude}`,
        `Reason: ${change.reason}`,
      ].join('\n');
      appendToFile(this._npcNarratorPath(change.npc_id), note);
    }
  }

  // ── 2.3 Player state ────────────────────────────────────────────────────────

  applyPlayerKnowledgeUpdate(playerId, newKnowledge) {
    const path  = this._playerStatePath(playerId);
    const state = readJSON(path);
    state.knowledge.push(newKnowledge);
    writeJSON(path, state);
  }

  applyPlayerBehavioralTag(playerId, tag) {
    const path  = this._playerStatePath(playerId);
    const state = readJSON(path);
    if (!state.behavioral_tags.includes(tag)) {
      state.behavioral_tags.push(tag);
      writeJSON(path, state);
    }
  }

  // ── 2.4 Reconciliation bundle ───────────────────────────────────────────────

  applyReconciliationBundle(updates) {
    this._applyNPCUpdates(updates.npc_updates ?? []);
    this._applyPlayerUpdates(updates.player_updates ?? []);
    this._applyLocationUpdates(updates.location_updates ?? []);
    this._applyCampaignUpdates(updates.campaign_updates ?? {});
  }

  _applyNPCUpdates(npcUpdates) {
    for (const u of npcUpdates) {
      const path  = this._npcStatePath(u.npc_id);
      const state = readJSON(path);

      if (u.new_attitude) {
        state.current_attitude = u.new_attitude;
        state.attitude_history.push({ encounter: u.encounter, turn: null, attitude: u.new_attitude });
      }

      for (const item of (u.knowledge_newly_revealed ?? [])) {
        if (!state.knowledge_revealed.includes(item)) {
          state.knowledge_revealed.push(item);
        }
        state.knowledge_locked = state.knowledge_locked.filter(k => k !== item);
      }

      writeJSON(path, state);

      if (u.narrator_card_append) {
        appendToFile(this._npcNarratorPath(u.npc_id), `\n\n---\n\n${u.narrator_card_append}`);
      }
    }
  }

  _applyPlayerUpdates(playerUpdates) {
    for (const u of playerUpdates) {
      const path  = this._playerStatePath(u.player_id);
      const state = readJSON(path);

      for (const tag of (u.new_behavioral_tags ?? [])) {
        if (!state.behavioral_tags.includes(tag)) {
          state.behavioral_tags.push(tag);
        }
      }

      for (const item of (u.new_knowledge ?? [])) {
        if (!state.knowledge.includes(item)) {
          state.knowledge.push(item);
        }
      }

      writeJSON(path, state);

      if (u.narrator_card_append) {
        appendToFile(this._playerNarratorPath(u.player_id), `\n\n---\n\n${u.narrator_card_append}`);
      }
    }
  }

  _applyLocationUpdates(locationUpdates) {
    for (const u of locationUpdates) {
      if (u.object_changes?.length > 0) {
        const path  = this._locationStatePath(u.location_id);
        const state = readJSON(path);
        for (const change of u.object_changes) {
          const obj = state.objects.find(o => o.id === change.object_id);
          if (!obj) continue;
          obj.current_state = change.new_state;
          obj.interacted_by = change.interacted_by;
          obj.interaction   = change.interaction;
        }
        writeJSON(path, state);
      }

      if (u.narrator_card_append) {
        appendToFile(this._locationNarratorPath(u.location_id), `\n\n---\n\n${u.narrator_card_append}`);
      }
    }
  }

  _applyCampaignUpdates(cu) {
    if (!cu || Object.keys(cu).length === 0) return;

    const campaign = readJSON(this._campaignPath());

    // Merge world_state.flags
    if (cu.world_state?.flags) {
      campaign.world_state.flags = { ...campaign.world_state.flags, ...cu.world_state.flags };
    }

    // Merge progress fields (arrays are union-merged, scalars are replaced)
    if (cu.progress) {
      for (const [key, value] of Object.entries(cu.progress)) {
        if (Array.isArray(campaign.progress[key]) && Array.isArray(value)) {
          campaign.progress[key] = [...new Set([...campaign.progress[key], ...value])];
        } else {
          campaign.progress[key] = value;
        }
      }
    }

    // Mark triggered revelation conditions
    for (const conditionId of (cu.conditions_triggered ?? [])) {
      for (const encounter of campaign.encounters) {
        const cond = encounter.revelation_conditions?.find(c => c.id === conditionId);
        if (cond) cond.triggered = true;
      }
    }

    writeJSON(this._campaignPath(), campaign);
  }
}

# 06 — Orchestrator

## Design Principle

The orchestrator is **pure code — not an agent**. It makes deterministic decisions based on structured data. Every decision it makes can be expressed as an if/else or switch statement. No LLM calls, no natural language interpretation, no creativity.

The orchestrator is the skeleton of the system. It should be the thing you can trust absolutely.

## Responsibility Boundary

```
PURE CODE — deterministic, no LLM
  Orchestrator        reads resolver_result.json
                      decides execution order
                      calls agents in sequence
                      manages file read/write
                      handles errors and retries
                      appends player input to session.json

  State Manager       mechanical JSON read/write operations
                      object state changes
                      NPC attitude updates
                      player knowledge updates
                      simple template-based narrator card updates

AGENTS — generative, LLM-powered
  Intake Agent        natural language onboarding
  Planner Agent       arc generation, revelation appends, reconciliation
  Resolver Agent      condition evaluation (outputs structured JSON)
  Narrator Agent      scene setting, narration
  Summarizer Agent    factual encounter summary
```

The dividing line: **anything that requires reading structured data and writing structured data is pure code. Anything that requires reading structured data and writing prose is the planner. Anything that requires reading prose and writing prose is the narrator.**

## Setup Phase

```javascript
async function setupCampaign() {

  // 1. Intake Agent — conversational, player-facing
  //    Runs a multi-turn conversation with players
  //    Outputs: intake.json
  const intakeData = await intake.run();
  writeJSON('campaign/intake.json', intakeData);

  // 2. Planner Agent — single non-interactive call
  //    Consumes intake.json, generates entire campaign
  //    Outputs: campaign.json, arc_brief.md, world_primer.md,
  //             all enc_XXX.md, all NPC folders, all location folders
  await planner.generateCampaign(intakeData);

  // 3. Orchestrator — pure code setup
  //    Creates session.json from campaign.json
  //    Creates player folders from intake.json party data
  const campaign = readJSON('campaign/campaign.json');
  const session = {
    campaign_id: campaign.meta.campaign_id,
    current_encounter_index: 0,
    current_encounter_id: campaign.encounters[0].id,
    encounter_status: 'awaiting_scene_open',
    turn_count: 0,
    player_inputs: []
  };
  writeJSON('campaign/session.json', session);

  // Create player cards from intake data
  for (const player of intakeData.party) {
    createPlayerCard(player);
  }

  // 4. Narrator — opens the first scene
  const narration = await narrator.openScene();
  return narration;
}
```

## Per-Turn Loop

This is the core game loop. Executes on every player input.

```javascript
async function processTurn(playerInput) {

  // ── STEP 1: Update session state (pure code) ──────────────
  const session = readJSON('campaign/session.json');
  session.player_inputs.push(playerInput);
  session.turn_count++;
  writeJSON('campaign/session.json', session);

  // ── STEP 2: Resolver (LLM Call 1 — always runs) ──────────
  const campaign = readJSON('campaign/campaign.json');
  const currentEncounter = campaign.encounters[session.current_encounter_index];

  const result = await resolver.evaluate({
    input: playerInput,
    accumulated_inputs: session.player_inputs,
    revelation_conditions: currentEncounter.revelation_conditions,
    resolution_conditions: currentEncounter.resolution_conditions,
    location_secrets: campaign.location_secrets[currentEncounter.location_id] || null,
    npc_attitudes: getActiveNPCAttitudes(currentEncounter)
  });

  writeJSON('campaign/resolver_result.json', result);

  // ── STEP 3: State Manager — mechanical updates (pure code) ──
  if (result.object_state_changes.length > 0) {
    stateManager.applyObjectChanges(result.object_state_changes);
  }

  // ── STEP 4: Planner — revelation append (LLM Call 2 — conditional) ──
  if (result.revelation_triggers.length > 0) {
    await planner.applyRevelations(result.revelation_triggers);
  }

  // ── STEP 5: Planner — narrative object update (LLM Call 3 — conditional) ──
  if (result.requires_narrative_update) {
    await planner.updateNarrativeForStateChanges(result.object_state_changes);
  }

  // ── STEP 5b: State Manager — NPC attitude updates (pure code — conditional) ──
  // Must run BEFORE the narrator (Call 4) so the updated attitude is
  // visible in npc_narrator.md on the same turn it changes.
  if (result.npc_attitude_changes.length > 0) {
    stateManager.applyAttitudeChanges(result.npc_attitude_changes);
  }

  // ── STEP 6: Check for encounter resolution ────────────────
  if (result.resolution_triggered) {
    return await handleEncounterTransition(result);
  }

  // ── STEP 7: Narrator — continue encounter (LLM Call 4 — always) ──
  const narration = await narrator.continueTurn(playerInput);
  return narration;
}
```

## Encounter Transition

Triggered when the resolver signals that a resolution condition has been met.

```javascript
async function handleEncounterTransition(resolverResult) {

  const session = readJSON('campaign/session.json');
  const campaign = readJSON('campaign/campaign.json');

  // ── STEP 1: Narrator — close current encounter (LLM Call 5) ──
  //    Narrates the resolution beat and closes the scene.
  //    Runs first so the player receives an immediate response to
  //    the action that triggered resolution.
  const closeNarration = await narrator.closeEncounter(resolverResult);

  // ── STEP 2: Summarizer (LLM Call 6) ───────────────────────
  //    Single call at encounter close. Produces factual summary.
  const summary = await summarizer.summarize({
    encounter_exchange: getEncounterExchange(session),
    resolution: resolverResult
  });
  writeFile(`campaign/encounters/enc_${session.current_encounter_id}_summary.md`, summary);

  // ── STEP 3: Planner — reconciliation pass (LLM Call 7) ────
  //    Most expensive call. Reviews encounter holistically.
  //    Outputs a structured update bundle.
  const updates = await planner.closeEncounter({
    encounter_summary: summary,
    resolver_result: resolverResult
  });

  // ── STEP 4: Apply reconciliation updates (pure code) ──────
  stateManager.applyReconciliationBundle(updates);

  // ── STEP 5: Planner — open next encounter (LLM Call 8) ────
  //    Adjusts next encounter brief if needed.
  const nextIndex = session.current_encounter_index + 1;

  if (nextIndex >= campaign.encounters.length) {
    // Campaign complete — handle ending
    const campaignClose = await narrator.closeCampaign();
    return { closeNarration, openNarration: campaignClose };
  }

  await planner.openNextEncounter({
    completed_summary: summary,
    next_encounter: campaign.encounters[nextIndex],
    player_states: getAllPlayerStates(),
    campaign_progress: campaign.progress
  });

  // ── STEP 6: Reset session for new encounter (pure code) ───
  session.current_encounter_index = nextIndex;
  session.current_encounter_id = campaign.encounters[nextIndex].id;
  session.encounter_status = 'awaiting_scene_open';
  session.turn_count = 0;
  session.player_inputs = [];
  writeJSON('campaign/session.json', session);

  // ── STEP 7: Narrator — open new scene (LLM Call 9) ────────
  //    Fresh context window — no prior turn history.
  const openNarration = await narrator.openScene();
  return { closeNarration, openNarration };
}
```

## State Manager

Pure code utility class. No LLM calls. Handles all mechanical JSON read/write operations.

```javascript
class StateManager {

  applyObjectChanges(changes) {
    for (const change of changes) {
      const statePath = `campaign/locations/${change.location}/state.json`;
      const state = readJSON(statePath);
      const obj = state.objects.find(o => o.id === change.object_id);
      if (obj) {
        obj.current_state = change.new_state;
        obj.interacted_by = change.interacted_by;
        obj.interaction = change.interaction;
        obj.encounter = change.encounter_id;
      }
      writeJSON(statePath, state);
    }
  }

  applyNPCAttitudeChange(npcId, newAttitude, encounter) {
    const statePath = `campaign/npcs/${npcId}/state.json`;
    const state = readJSON(statePath);
    state.current_attitude = newAttitude;
    state.attitude_history.push({ encounter, attitude: newAttitude });
    writeJSON(statePath, state);
  }

  applyAttitudeChanges(changes) {
    // Processes npc_attitude_changes[] from resolver_result.json mid-turn.
    // Runs before the narrator (Call 4) so attitude is current in the same turn.
    for (const change of changes) {
      // Update structured state
      this.applyNPCAttitudeChange(
        change.npc_id,
        change.new_attitude,
        change.encounter_id
      );
      // Append a brief factual note to the narrator card so the
      // narrator reads the updated attitude without an LLM call.
      const cardPath = `campaign/npcs/${change.npc_id}/${change.npc_id}_narrator.md`;
      const note = [
        `\n---`,
        `## Attitude shift — Turn ${change.turn}`,
        `${change.npc_id}: ${change.previous_attitude} → ${change.new_attitude}`,
        `Reason: ${change.reason}`
      ].join('\n');
      appendToFile(cardPath, note);
    }
  }

  applyPlayerKnowledgeUpdate(playerId, newKnowledge) {
    const statePath = `campaign/players/${playerId}/state.json`;
    const state = readJSON(statePath);
    state.knowledge.push(newKnowledge);
    writeJSON(statePath, state);
  }

  applyPlayerBehavioralTag(playerId, tag) {
    const statePath = `campaign/players/${playerId}/state.json`;
    const state = readJSON(statePath);
    if (!state.behavioral_tags.includes(tag)) {
      state.behavioral_tags.push(tag);
    }
    writeJSON(statePath, state);
  }

  applyReconciliationBundle(updates) {
    // The planner outputs a structured JSON bundle.
    // This method fans the updates out to the correct files.

    if (updates.npc_updates) {
      for (const npcUpdate of updates.npc_updates) {
        this.applyNPCAttitudeChange(
          npcUpdate.npc_id,
          npcUpdate.new_attitude,
          npcUpdate.encounter
        );
        // Move knowledge items from locked to revealed
        if (npcUpdate.knowledge_newly_revealed) {
          const state = readJSON(`campaign/npcs/${npcUpdate.npc_id}/state.json`);
          for (const item of npcUpdate.knowledge_newly_revealed) {
            state.knowledge_locked = state.knowledge_locked.filter(k => k !== item);
            state.knowledge_revealed.push(item);
          }
          writeJSON(`campaign/npcs/${npcUpdate.npc_id}/state.json`, state);
        }
        // Append to narrator card
        if (npcUpdate.narrator_card_append) {
          appendToFile(
            `campaign/npcs/${npcUpdate.npc_id}/${npcUpdate.npc_id}_narrator.md`,
            npcUpdate.narrator_card_append
          );
        }
      }
    }

    if (updates.player_updates) {
      for (const playerUpdate of updates.player_updates) {
        if (playerUpdate.new_behavioral_tags) {
          for (const tag of playerUpdate.new_behavioral_tags) {
            this.applyPlayerBehavioralTag(playerUpdate.player_id, tag);
          }
        }
        if (playerUpdate.new_knowledge) {
          for (const item of playerUpdate.new_knowledge) {
            this.applyPlayerKnowledgeUpdate(playerUpdate.player_id, item);
          }
        }
        if (playerUpdate.narrator_card_append) {
          appendToFile(
            `campaign/players/${playerUpdate.player_id}/${playerUpdate.player_id}_narrator.md`,
            playerUpdate.narrator_card_append
          );
        }
      }
    }

    if (updates.location_updates) {
      for (const locUpdate of updates.location_updates) {
        this.applyObjectChanges(locUpdate.object_changes || []);
        if (locUpdate.narrator_card_append) {
          appendToFile(
            `campaign/locations/${locUpdate.location_id}/${locUpdate.location_id}_narrator.md`,
            locUpdate.narrator_card_append
          );
        }
      }
    }

    if (updates.campaign_updates) {
      const campaign = readJSON('campaign/campaign.json');
      if (updates.campaign_updates.world_state) {
        Object.assign(campaign.world_state, updates.campaign_updates.world_state);
      }
      if (updates.campaign_updates.progress) {
        Object.assign(campaign.progress, updates.campaign_updates.progress);
      }
      // Mark triggered conditions
      if (updates.campaign_updates.conditions_triggered) {
        for (const condId of updates.campaign_updates.conditions_triggered) {
          markConditionTriggered(campaign, condId);
        }
      }
      writeJSON('campaign/campaign.json', campaign);
    }
  }
}
```

## Error Handling Considerations

### Per-Agent Failures

- If the resolver fails, do not proceed — the turn cannot be processed without condition evaluation. session.json is NOT written; the turn is not consumed. The player may resend the same input.
- If the planner fails during revelation append, the narrator can still run — it just won't have the new REVEALED content. Log the failure and set a retry flag in session.json (`pending_revelation_triggers: [...]`). Retry the append at the start of the next turn before calling the resolver.
- If the narrator fails, return an error to the player and allow retry. Turn state is preserved — the resolver has already run but session.json turn_count is not incremented further.
- If `narrator.closeEncounter()` fails during encounter transition, do not proceed — the player would receive no response to their resolution action. Return an error and allow retry of the same input.
- If the summarizer fails at encounter close, fall back to passing the raw `encounter_exchange` string directly to `planner.closeEncounter()` as the `encounter_summary` field. Skip writing `enc_XXX_summary.md`. Log the fallback.
- All JSON writes must use the atomic write pattern (write to temp file, then `fs.renameSync` to target) to prevent corruption on crash.

### API Rate Limits and Transient Errors

Anthropic API errors divide into two categories:

**Retriable:** Retry with exponential backoff.
- `429` — rate limit exceeded
- `529` / `overloaded_error` — API overloaded
- `500` — server error
- Network timeout / connection reset

**Non-retriable:** Log and surface immediately as an application error.
- `400` — bad request (malformed prompt — fix the prompt, not the retry logic)
- `401` — invalid API key
- `403` — permission denied
- `404` — model not found

**Retry strategy:** exponential backoff with jitter.
- Initial delay: 1 second
- Multiplier: 2× per attempt
- Jitter: ±20% of the computed delay (prevents thundering herd)
- Maximum delay: 30 seconds
- Maximum attempts: 3 for all calls except `generateCampaign` (see below)
- On final failure: surface as an application error per the per-agent rules above

```javascript
async function withRetry(fn, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetriable(err) || attempt === maxAttempts) throw err;
      const base = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
      const jitter = base * 0.2 * (Math.random() * 2 - 1);
      await sleep(base + jitter);
    }
  }
}

function isRetriable(err) {
  const status = err.status ?? err.statusCode;
  return status === 429 || status === 529 || status === 500 || err.code === 'ECONNRESET';
}
```

### Campaign Generation Partial Failure

`generateCampaign()` is the highest-risk call — it writes many files in sequence. A failure mid-write leaves `campaign/` in a partial state (some files present, others absent).

**Detection:** On `POST /setup`, before calling `planner.generateCampaign()`, check for a partial state:
```javascript
const hasIntake = existsSync('campaign/intake.json');
const hasCampaign = existsSync('campaign/campaign.json');
if (hasIntake && !hasCampaign) {
  // Partial state from a previous failed setup
  throw { error: 'setup_failed', message: 'Partial campaign detected. Delete campaign/ and retry.' };
}
```

**Recovery:** The operator must manually delete `campaign/` and restart from intake. Automatic cleanup is not safe — the partial files may be useful for debugging the prompt failure.

**Retry budget for `generateCampaign`:** Use 2 attempts maximum (not 3). This call is expensive and a second failure after one retry likely indicates a prompt or quota problem, not a transient error.

## Prompt Caching Optimization

Anthropic supports prompt caching for content that doesn't change between calls. Key candidates:
- **Narrator system prompt + world_primer.md**: Loaded on every narrator call, never changes during a session. Cache these as the system prompt prefix.
- **Resolver system prompt**: Loaded every turn, never changes. Cache.
- **Player narrator cards**: Change infrequently (only post-encounter). Cache within an encounter.

# 11 — Work Breakdown Structure

## Overview

The system is built in dependency order: utilities first, then pure-code components, then agents in the order they appear in the turn loop. Each phase has an independently verifiable output so work can be validated before the next phase begins.

Agents that are not yet built are **stubbed** — their interface is present in the orchestrator from day one, but they return a hardcoded fixture response. This means the turn loop is runnable after Phase 2, long before any real LLM calls exist.

| Phase | Name | Primary Output | Verify By |
|---|---|---|---|
| 0 | Project Scaffold | Runnable Node.js project | `node index.js` exits cleanly |
| 1 | Orchestrator Skeleton | Turn loop with all stubs | Single turn runs end-to-end using fixtures |
| 2 | State Manager | JSON read/write utility class | Unit tests against fixture files |
| 3 | Resolver Agent | First real LLM call; structured JSON output | Known input → expected resolver_result.json |
| 4 | Planner Agent | Campaign generation + mid-turn operations | Valid campaign file tree generated from fixture intake.json |
| 5 | Narrator Agent | Player-facing narration | Coherent scene output; no Tier 3 info in context |
| 6 | Summarizer Agent | enc_XXX_summary.md | Summary is factual, not narrative |
| 7 | Intake Agent | intake.json | Conversation produces complete, valid intake.json |
| 8 | Full Integration | All stubs replaced with real agents | Full two-encounter run completes without error |
| 9 | End-to-End Validation | System behaves per spec | All file access matrix rules verified |

---

## Phase 0 — Project Scaffold

**Depends on:** nothing  
**Produces:** runnable Node.js project with folder structure and shared utilities

### 0.1 Node.js Project Init
- [ ] Create `package.json` (name, version, `"type": "module"`, main entry)
- [ ] Add `anthropic` SDK to dependencies
- [ ] Add `dotenv` for API key loading
- [ ] Create `.env.example` with `ANTHROPIC_API_KEY=` placeholder
- [ ] Create `.gitignore` (node_modules, .env, campaign/)
- [ ] Create `README.md` linking to docs/

### 0.2 Folder Scaffold
- [ ] Create `agents/` directory with empty placeholder files: `intake.js`, `planner.js`, `resolver.js`, `narrator.js`, `summarizer.js`
- [ ] Create `prompts/` directory with empty placeholder files: `intake_system.txt`, `planner_system.txt`, `planner_revelation.txt`, `planner_reconciliation.txt`, `planner_open_encounter.txt`, `resolver_system.txt`, `narrator_system.txt`, `summarizer_system.txt`
- [ ] Create `campaign/` directory (gitignored) with empty `encounters/`, `locations/`, `npcs/`, `players/` subdirectories

### 0.3 Shared File Utilities (`fileUtils.js`)
- [ ] `readJSON(path)` — parse and return JSON file
- [ ] `writeJSON(path, data)` — atomic write: serialize to temp file, then `fs.renameSync` to target path (prevents corruption on crash)
- [ ] `readFile(path)` — return raw file contents as string
- [ ] `writeFile(path, content)` — write string to file, create parent dirs if absent
- [ ] `appendToFile(path, content)` — append string to existing file
- [ ] `getEncounterExchange(session)` — returns formatted turn-by-turn exchange from `session.player_inputs[]` for use as summarizer input

**Verify:** `node -e "import('./fileUtils.js')"` loads without error; manually test each utility against a temp fixture file.

---

## Phase 1 — Orchestrator Skeleton

**Depends on:** Phase 0 (fileUtils.js)  
**Produces:** fully structured turn loop with all agents stubbed; one turn runnable end-to-end

The goal is a working skeleton — all routing logic is correct, all file paths and JSON shapes are real, but every agent call returns a hardcoded fixture. This validates the loop architecture without any LLM costs.

### 1.1 Stub Agents
For each agent file, implement the minimum interface the orchestrator needs — return a valid fixture response:

- [ ] `intake.js` → `run()` returns the example intake.json from `docs/03-data-schemas.md`
- [ ] `resolver.js` → `evaluate(input)` returns a fixture resolver_result.json (no revelation, no resolution, no attitude changes)
- [ ] `planner.js` → `generateCampaign(intake)`, `applyRevelations(triggers)`, `updateNarrativeForStateChanges(changes)`, `closeEncounter(params)`, `openNextEncounter(params)` — each logs its call and returns a minimal valid fixture
- [ ] `narrator.js` → `openScene()`, `continueTurn(input)`, `closeCampaign()` — each returns a hardcoded narration string
- [ ] `summarizer.js` → `summarize(params)` returns a hardcoded summary string

### 1.2 Orchestrator — Setup Phase (`setupCampaign()` in `index.js`)
- [ ] Call `intake.run()` → write `campaign/intake.json`
- [ ] Call `planner.generateCampaign(intakeData)` (stub)
- [ ] Read `campaign/campaign.json`; create and write `campaign/session.json` with correct initial shape
- [ ] Create `player_narrator.md` and `player_state.json` files from intake party data (pure code — no LLM)
- [ ] Call `narrator.openScene()` → return narration

### 1.3 Orchestrator — Per-Turn Loop (`processTurn(playerInput)` in `index.js`)
Implement all steps exactly as specified in `docs/06-orchestrator.md`:

- [ ] **Step 1** — Append `playerInput` to `session.player_inputs[]`, increment `turn_count`, write `session.json`
- [ ] **Step 2** — Call `resolver.evaluate(...)` with all required inputs; write `resolver_result.json`
- [ ] **Step 3** — If `result.object_state_changes.length > 0`, call `stateManager.applyObjectChanges()`
- [ ] **Step 4** — If `result.revelation_triggers.length > 0`, call `planner.applyRevelations()`
- [ ] **Step 5** — If `result.requires_narrative_update`, call `planner.updateNarrativeForStateChanges()`
- [ ] **Step 5b** — If `result.npc_attitude_changes.length > 0`, call `stateManager.applyAttitudeChanges()` — must run **before** narrator (Step 7)
- [ ] **Step 6** — If `result.resolution_triggered`, call `handleEncounterTransition(result)` and return early
- [ ] **Step 7** — Call `narrator.continueTurn(playerInput)` → return narration

### 1.4 Orchestrator — Encounter Transition (`handleEncounterTransition(resolverResult)`)
- [ ] **Step 1** — Call `summarizer.summarize(...)` → write `enc_XXX_summary.md`
- [ ] **Step 2** — Call `planner.closeEncounter(...)` → receive reconciliation bundle
- [ ] **Step 3** — Call `stateManager.applyReconciliationBundle(updates)`
- [ ] **Step 4** — Check `nextIndex >= campaign.encounters.length`; if so, call `narrator.closeCampaign()` and return
- [ ] **Step 5** — Call `planner.openNextEncounter(...)`
- [ ] **Step 6** — Reset `session.json` for new encounter (new index, id, `awaiting_scene_open`, turn_count: 0, player_inputs: [])
- [ ] **Step 7** — Call `narrator.openScene()` → return narration

**Verify:** With all agents stubbed, call `setupCampaign()` then three turns of `processTurn()` then one more turn that triggers the stub's hardcoded resolution. All session.json writes should be correct. No errors thrown.

---

## Phase 2 — State Manager

**Depends on:** Phase 0 (fileUtils.js), Phase 1 skeleton (so method signatures are known)  
**Produces:** fully tested `stateManager.js` with all JSON read/write operations

Build and test the state manager against fixture JSON files before wiring it into the real turn loop.

### 2.1 Object State Operations
- [ ] `applyObjectChanges(changes)` — find object by `object_id` in `location_state.json`, update `current_state`, `interacted_by`, `interaction`, `encounter`; write back atomically

### 2.2 NPC State Operations
- [ ] `applyNPCAttitudeChange(npcId, newAttitude, encounter)` — update `current_attitude`; push entry to `attitude_history[]`; write `npc_state.json`
- [ ] `applyAttitudeChanges(changes)` — iterate `npc_attitude_changes[]` from resolver_result.json; for each change call `applyNPCAttitudeChange()`; then append formatted attitude-shift note to `npc_narrator.md` — format: `\n---\n## Attitude shift — Turn N\n{npc_id}: {previous} → {new}\nReason: {reason}`. This method must run **before** the narrator on every turn where changes are present.

### 2.3 Player State Operations
- [ ] `applyPlayerKnowledgeUpdate(playerId, newKnowledge)` — push to `player_state.json` knowledge array
- [ ] `applyPlayerBehavioralTag(playerId, tag)` — push to `behavioral_tags[]` only if not already present (deduplication)

### 2.4 Reconciliation Bundle
- [ ] `applyReconciliationBundle(updates)` — fan out structured update bundle from planner's closeEncounter call:
  - NPC: attitude, knowledge_newly_revealed (move from locked → revealed), narrator card append
  - Player: new behavioral_tags, new knowledge, narrator card append
  - Location: object changes, narrator card append
  - Campaign: merge world_state, merge progress, mark triggered conditions in encounters array

**Verify:** Unit tests using fixture JSON files (copy from `docs/03-data-schemas.md` examples). Test each method individually. Test `applyReconciliationBundle` with a bundle that touches all update types simultaneously.

---

## Phase 3 — Resolver Agent

**Depends on:** Phase 0 (fileUtils.js), Phase 2 (stateManager — to verify attitude change integration)  
**Produces:** first real LLM call; deterministic structured JSON output

The resolver is the best first agent to build: it outputs JSON (verifiable without reading prose), it runs every turn, and its output schema is the contract everything else depends on.

### 3.1 Resolver System Prompt (`prompts/resolver_system.txt`)
Write the full system prompt as specified in `docs/05-agents.md`:
- [ ] Role definition: condition evaluator, not router
- [ ] Input description: player input, accumulated inputs, revelation conditions, resolution conditions, location secrets, NPC attitudes
- [ ] Evaluation guidance: intent and meaning, not string matching
- [ ] Attitude shift evaluation rules: any of five attitudes can shift to any other in one turn; evaluate every turn; empty array if no shift
- [ ] Attitude shift examples (all four from the spec)
- [ ] Strict JSON-only output instruction
- [ ] Exact output schema with all fields and their semantics

### 3.2 Resolver Implementation (`agents/resolver.js`)
- [ ] `evaluate(params)` — assemble prompt from inputs, call LLM, parse and validate JSON response
- [ ] Inputs wired per spec: `playerInput`, `session.player_inputs[]`, `revelation_conditions[]`, `resolution_conditions`, `location_secrets`, active NPC attitudes from `npc_state.json`
- [ ] Load only `npc_state.json` for NPCs listed in `currentEncounter` — not all NPCs
- [ ] Validate response contains all required fields: `encounter_id`, `turn`, `revelation_triggers[]`, `resolution_triggered`, `object_state_changes[]`, `npc_attitude_changes[]`, `encounter_continues`, `requires_narrative_update`, `notes`
- [ ] Add prompt caching header to system prompt (Anthropic cache_control)

### 3.3 Replace Resolver Stub
- [ ] Swap stub in orchestrator for real `resolver.evaluate()`
- [ ] Confirm `resolver_result.json` is written after every turn

**Verify:** Using a fixture campaign with known revelation/resolution conditions, submit a player input that should trigger a revelation. Confirm `revelation_triggers` is populated. Submit an input that should trigger resolution. Confirm `resolution_triggered` is set. Submit a hostile player action toward a cautious NPC. Confirm `npc_attitude_changes` is populated. Submit a neutral action. Confirm `npc_attitude_changes` is `[]`.

---

## Phase 4 — Planner Agent

**Depends on:** Phase 0, Phase 2 (state manager processes planner output), Phase 3 (resolver triggers planner)  
**Produces:** campaign file tree, revelation appends, narrative updates, reconciliation bundle, encounter transitions

The planner is the most complex agent — it has five distinct call patterns with different inputs and outputs. Build and validate them in dependency order (generation first, then mid-turn operations, then encounter close).

### 4.1 Planner System Prompt — Arc Generation (`prompts/planner_system.txt`)
- [ ] Role definition: master campaign planner, never player-facing
- [ ] Output instruction: all seven required file types (campaign.json, arc_brief.md, world_primer.md, enc_XXX.md per encounter, NPC folders, location folders)
- [ ] Critical constraint: enc_XXX.md must contain **no** hidden information (no victory/failure conditions, no plot secrets, no revelation triggers)
- [ ] Critical constraint: victory/failure/partial conditions → campaign.json only
- [ ] Critical constraint: revelation conditions and triggers → campaign.json only
- [ ] Critical constraint: NPC hidden briefs → separate files from narrator cards
- [ ] Critical constraint: location secrets → campaign.json only
- [ ] Tone/pacing/combat-ratio must derive from intake.json player preferences
- [ ] Player backstory hooks must be woven into the arc

### 4.2 Planner System Prompt — Revelation Append (`prompts/planner_revelation.txt`)
- [ ] Inputs: triggered condition IDs and approved content, current enc_XXX.md, relevant npc_hidden.md if NPC-related, arc_brief.md for arc context
- [ ] Output: append a `## REVEALED — [Turn N]` section to the appropriate narrator-facing file(s)
- [ ] Rule: only surface the specific triggered revelation — no adjacent secrets
- [ ] Rule: match existing prose style
- [ ] Rule: write narrator-directed guidance ("She will now respond to..." / "Do not volunteer this...")

### 4.3 Planner System Prompt — Reconciliation (`prompts/planner_reconciliation.txt`)
- [ ] Input: encounter summary and resolver result
- [ ] Output: structured JSON update bundle covering all eight update types (NPC, player, location, campaign)
- [ ] Instruction: write all prose in past tense, factually — these are records, not narration
- [ ] Instruction: consider arc-level implications when updating planner_flags

### 4.4 Planner System Prompt — Open Next Encounter (`prompts/planner_open_encounter.txt`)
- [ ] Three cases: outcome as expected (confirm unchanged), outcome diverged (adjust brief), far off-script (regenerate remaining encounters and update arc_brief.md)
- [ ] Always update campaign.json progress to advance current_encounter_id

### 4.5 Planner Implementation (`agents/planner.js`)
- [ ] `generateCampaign(intakeData)` — LLM Call 2 (setup): consume intake.json, write all campaign files
- [ ] `applyRevelations(revelationTriggers)` — LLM Call 2 (mid-turn): append REVEALED section(s) to narrator card(s); inputs include triggered conditions, enc_XXX.md, relevant npc_hidden.md, arc_brief.md
- [ ] `updateNarrativeForStateChanges(objectStateChanges)` — LLM Call 3: handles state changes that require prose judgment; inputs are the changed objects and relevant location/NPC narrator cards
- [ ] `closeEncounter(params)` — LLM Call 6: produce full reconciliation bundle; inputs are encounter summary and resolver result
- [ ] `openNextEncounter(params)` — LLM Call 7: adjust or regenerate next encounter brief; inputs are completed summary, next encounter, player states, campaign progress

### 4.6 Replace Planner Stubs
- [ ] Swap `generateCampaign` stub — confirm full file tree is created
- [ ] Swap `applyRevelations` stub — confirm REVEALED section appears in correct file
- [ ] Swap `updateNarrativeForStateChanges` stub
- [ ] Swap `closeEncounter` stub — confirm reconciliation bundle passes to state manager
- [ ] Swap `openNextEncounter` stub

**Verify:** Run `generateCampaign` with fixture intake.json. Confirm all required files are created. Confirm enc_XXX.md files contain no hidden conditions. Confirm campaign.json contains all resolution/revelation conditions. Trigger a revelation mid-turn; confirm REVEALED section appended to correct file with correct format. Trigger encounter close; confirm reconciliation bundle is a valid JSON structure.

---

## Phase 5 — Narrator Agent

**Depends on:** Phase 0, Phase 4 (planner generates the files the narrator reads)  
**Produces:** player-facing narration; the only player-visible output during play

The narrator must never receive Tier 3 information. Context loading is the most critical correctness concern.

### 5.1 Narrator System Prompt (`prompts/narrator_system.txt`)
- [ ] Tone instruction with injection point for world_primer.md contents
- [ ] Rules: narrate from provided materials only; never reveal withheld information; portray NPCs per narrator cards; reflect REVEALED sections naturally without announcing them; pause after each beat and ask for player input
- [ ] Explicit prohibition: do not speculate about outcomes, future encounters, or hidden plot threads
- [ ] Format: set the beat, describe reactions, solicit input

### 5.2 Narrator Implementation — Context Loading
Context loading is a separate concern from narration. Build it before the LLM call.
- [ ] Tier 1 always loaded: `player_narrator.md` (all party members), `enc_XXX.md` (current encounter + all REVEALED sections), `world_primer.md`, full encounter conversation history from `session.player_inputs[]`
- [ ] Tier 2 on demand: `npc_narrator.md` for each NPC listed in current encounter; `location_narrator.md` for current location; `enc_XXX_summary.md` for previous encounter (transition context)
- [ ] Confirm NEVER loaded: `arc_brief.md`, `npc_hidden.md`, `campaign.json`, future enc_XXX.md files

### 5.3 Narrator Implementation — LLM Calls (`agents/narrator.js`)
- [ ] `openScene()` — encounter open context: enc_XXX+1.md, enc_XXX_summary.md (previous), player cards, NPC cards, location card; no turn history (fresh context window per spec)
- [ ] `continueTurn(playerInput)` — LLM Call 4: Tier 1 + Tier 2 context; full turn history for current encounter
- [ ] `closeCampaign()` — end-of-campaign narration; no strict input contract; use campaign summary context
- [ ] Add prompt caching header for system prompt + world_primer.md prefix (static across all narrator calls in a session)
- [ ] Add prompt caching header for player_narrator.md cards (change only post-encounter)

### 5.4 Replace Narrator Stubs
- [ ] Swap `openScene` stub
- [ ] Swap `continueTurn` stub
- [ ] Swap `closeCampaign` stub

**Verify:** Inspect the exact prompt assembled before each LLM call. Confirm `arc_brief.md`, `npc_hidden.md`, and `campaign.json` are absent. Confirm the REVEALED section is present in the enc_XXX.md text when a revelation has been triggered. Confirm NPC narrator card includes the most recent attitude-shift note when an attitude change occurred earlier in the encounter.

---

## Phase 6 — Summarizer Agent

**Depends on:** Phase 0, Phase 5 (encounter must have run to have a meaningful exchange to summarize)  
**Produces:** `enc_XXX_summary.md` — factual encounter record used by planner and narrator at transition

### 6.1 Summarizer System Prompt (`prompts/summarizer_system.txt`)
- [ ] Role: factual recorder, not narrator
- [ ] Output: factual prose summary of what occurred, who was involved, what was decided, what was discovered
- [ ] Tone: past tense, neutral, precise — no dramatisation
- [ ] Include: resolution outcome, revelation conditions triggered, NPC attitude states at close, player knowledge gained, object state changes

### 6.2 Summarizer Implementation (`agents/summarizer.js`)
- [ ] `summarize(params)` — LLM Call 5: inputs are `encounter_exchange` (from `getEncounterExchange(session)`) and `resolverResult`; output written to `enc_XXX_summary.md`
- [ ] `encounter_exchange` format: numbered turn list of player inputs and narration beats

### 6.3 Replace Summarizer Stub
- [ ] Swap `summarizer.summarize` stub in `handleEncounterTransition`

**Verify:** After a completed encounter, confirm summary is factual and concise (not dramatic narration). Confirm it records resolution outcome and any revelations triggered. Confirm it can be used as transition context for the narrator's `openScene()` on the next encounter.

---

## Phase 7 — Intake Agent

**Depends on:** Phase 0 only (intake runs before all other agents; its output is all the planner needs)  
**Produces:** `intake.json` — the seed for campaign generation

Intake can be built in any phase since it runs once at the start and its output is consumed only by the planner. It is listed last because a fixture intake.json suffices for developing all other phases.

### 7.1 Intake System Prompt (`prompts/intake_system.txt`)
- [ ] Role: warm, conversational session-zero facilitator
- [ ] Topics to gather, in order: party characters (name, class, personality, backstory hook), tone/mood, goals, time available, combat vs problem-solving ratio, content limits
- [ ] Framing instruction: ask preference questions in-world where possible
- [ ] End signal: when enough information gathered, produce intake.json without revealing that JSON is being produced

### 7.2 Intake Implementation (`agents/intake.js`)
- [ ] `run()` — LLM Call 1 (setup): multi-turn conversational loop; each player message → LLM → continue or produce output
- [ ] Termination: detect when LLM produces a JSON block; extract and validate intake.json shape
- [ ] Validate all required fields: `party[]` (name, class, personality, backstory_hook, playstyle_notes per member), `preferences` (tone, primary_goal, time_available, combat_ratio, problem_solving_preference, content_limits[])

### 7.3 Replace Intake Stub
- [ ] Swap `intake.run()` stub in `setupCampaign()`

**Verify:** Run intake with a real (or simulated) conversation. Confirm intake.json is complete and has all required fields. Confirm the agent ends the conversation naturally without exposing JSON to players.

---

## Phase 8 — Full Integration

**Depends on:** Phases 1–7  
**Produces:** all stubs replaced; complete system wired end-to-end

### 8.1 Confirm Stub Replacement Checklist
- [ ] `intake.run()` — real agent
- [ ] `resolver.evaluate()` — real agent
- [ ] `planner.generateCampaign()` — real agent
- [ ] `planner.applyRevelations()` — real agent
- [ ] `planner.updateNarrativeForStateChanges()` — real agent
- [ ] `planner.closeEncounter()` — real agent
- [ ] `planner.openNextEncounter()` — real agent
- [ ] `narrator.openScene()` — real agent
- [ ] `narrator.continueTurn()` — real agent
- [ ] `narrator.closeCampaign()` — real agent
- [ ] `summarizer.summarize()` — real agent

### 8.2 Error Handling (per `docs/06-orchestrator.md`)
- [ ] Resolver failure → log error, halt turn (do not proceed to narrator without resolver output)
- [ ] Planner revelation failure → log, continue to narrator without new REVEALED content; set retry flag for next turn
- [ ] Narrator failure → return error to player, allow retry without advancing turn state
- [ ] Summarizer failure → fall back to passing raw `encounter_exchange` directly to `planner.closeEncounter()` (skip enc_XXX_summary.md write)
- [ ] All `writeJSON` calls must use atomic write pattern (write temp → rename)

### 8.3 Entry Point (`index.js`)
- [ ] Expose a simple CLI or HTTP interface that accepts player input and returns narration
- [ ] `setupCampaign()` on first run (no `campaign/session.json` present)
- [ ] `processTurn(playerInput)` on all subsequent runs

---

## Phase 9 — End-to-End Validation

**Depends on:** Phase 8  
**Produces:** verified system conforming to all spec constraints

### 9.1 File Access Matrix Audit
Verify the exact file paths passed to each agent match the access matrix from `docs/02-file-structure.md`:
- [ ] Narrator: confirm `arc_brief.md` path is never constructed in `narrator.js`
- [ ] Narrator: confirm `npc_hidden.md` path is never constructed in `narrator.js`
- [ ] Narrator: confirm `campaign.json` is never read in `narrator.js`
- [ ] Resolver: confirm only `revelation_conditions[]`, `resolution_conditions`, `location_secrets`, and `npc_state.json` attitude field are passed in
- [ ] Orchestrator: confirm only structured JSON is read — no prose files loaded into orchestrator context

### 9.2 Information Separation Test
- [ ] Generate a campaign; inspect `enc_XXX.md` files — confirm zero victory/failure condition language
- [ ] Inspect `arc_brief.md` — confirm it exists, and that its path never appears in narrator context assembly code
- [ ] Trigger a revelation; inspect updated narrator file — confirm only the triggered revelation text appears, no adjacent secrets

### 9.3 Step 5b Sequencing Test
- [ ] Construct a turn where resolver returns a non-empty `npc_attitude_changes[]`
- [ ] Confirm `stateManager.applyAttitudeChanges()` runs **before** `narrator.continueTurn()`
- [ ] Confirm the NPC's `npc_narrator.md` contains the attitude-shift note when the narrator's context is assembled

### 9.4 Full Campaign Run
- [ ] Run a complete two-encounter campaign from intake through the end of encounter 2
- [ ] Confirm all expected files exist and have correct content at each phase
- [ ] Confirm encounter transition produces `enc_001_summary.md` and resets session correctly

---

## Dependency Graph

```
Phase 0 (scaffold, fileUtils)
    └── Phase 1 (orchestrator skeleton — all stubs)
            └── Phase 2 (state manager — unit tested in isolation)
            └── Phase 3 (resolver — first real LLM call)
                    └── Phase 4 (planner — depends on resolver output schema)
                            └── Phase 5 (narrator — reads planner-generated files)
                            └── Phase 6 (summarizer — runs after encounter has played out)
            └── Phase 7 (intake — independent, builds on Phase 0 only)
Phase 8 (integration — all stubs replaced, error handling added)
    └── Phase 9 (validation — file access matrix, sequencing, full run)
```

Phases 3, 4, 5, 6 must follow the left-to-right sequence shown.  
Phase 7 can be built in parallel with Phases 3–6.  
Phases 8 and 9 must be last.

---

## Stubbing Reference

When an agent is not yet built, implement it as a minimal fixture in its agent file:

```javascript
// agents/resolver.js — stub (Phase 1)
export async function evaluate(params) {
  console.log('[STUB] resolver.evaluate called');
  return {
    encounter_id: params.encounterId,
    turn: params.turn,
    revelation_triggers: [],
    resolution_triggered: null,
    object_state_changes: [],
    npc_attitude_changes: [],
    encounter_continues: true,
    requires_narrative_update: false,
    notes: 'stub response'
  };
}
```

Each stub:
- Logs its call with `[STUB]` prefix so it is obvious which agents are still stubs
- Returns the minimum valid shape for its output contract (match the schema in `docs/03-data-schemas.md`)
- Does not write any files (the orchestrator writes `resolver_result.json`, not the stub)

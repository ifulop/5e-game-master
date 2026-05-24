# 07 — LLM Call Inventory

## Overview

The system makes between 2 and 8 LLM calls per player turn, depending on conditions. Calls 1 and 4 fire every turn. Calls 2, 3 are conditional mid-turn. Calls 5-8 fire once per encounter transition.

## Token Cost Principles

- **Input tokens** are cheaper than **output tokens** (roughly 3-5x cheaper per token).
- Every API call has per-request overhead: network round trip, model initialization, rate limit consumption.
- **Batching is valuable**: one large call beats five medium calls when they share base context.
- **Prompt caching**: content that doesn't change between calls (system prompts, world_primer.md) can be cached at significant discount.
- The per-turn loop (Calls 1-4) fires on every player input — keeping these lean matters more than optimizing infrequent calls.

---

## Per-Turn Loop (fires every player turn)

### Call 1 — Resolver: Condition Evaluation

| Field | Value |
|---|---|
| Agent | Resolver |
| Frequency | Every turn |
| Conditional | No — always runs |

**System Prompt:**
- Resolver evaluation instructions
- JSON output format specification

**Prompt Inputs:**
| Input | Source | Notes |
|---|---|---|
| Player input (current turn) | Raw text from player | Single turn only |
| Accumulated player inputs | session.json → player_inputs[] | All inputs this encounter |
| Revelation conditions | campaign.json → current encounter → revelation_conditions[] | Structured conditions |
| Resolution conditions | campaign.json → current encounter → resolution_conditions | Victory/failure/partial |
| Location secret conditions | campaign.json → location_secrets → revelation_conditions[] | For current location |
| Active NPC attitudes | npc_state.json (active NPCs) → current_attitude | Structured data only |

**Output:** `resolver_result.json`

**Cost Profile:** Cheapest call in the loop. No prose input. Small structured output. System prompt is cacheable.

---

### Call 2 — Planner: Revelation Append

| Field | Value |
|---|---|
| Agent | Planner |
| Frequency | Per turn (conditional) |
| Conditional | Only if resolver_result.json → revelation_triggers[] is not empty |

**System Prompt:**
- Revelation append instructions
- Tone/style matching guidance
- Rules: only surface specific triggered revelation, do not leak adjacent secrets

**Prompt Inputs:**
| Input | Source | Notes |
|---|---|---|
| Revelation trigger IDs | resolver_result.json → revelation_triggers[] | Which conditions were met |
| Arc brief | arc_brief.md | Context for how revelation fits the story |
| Current encounter brief | enc_XXX.md | To match established prose style |
| NPC hidden brief | npc_hidden.md (triggered NPC only) | If NPC-related trigger |
| Location secrets | campaign.json → location_secrets (if location trigger) | Hidden location facts |
| World primer | world_primer.md | Tone/style reference |

**Output:** Appends REVEALED section to one or more of:
- enc_XXX.md
- npc_narrator.md (if NPC trigger)
- location_narrator.md (if location trigger)

Also updates campaign.json → triggered flag to true (via State Manager).

**Cost Profile:** Medium. Prose input and prose output. Can handle multiple simultaneous triggers in one call — pass all triggered IDs together rather than calling once per trigger.

---

### Call 3 — Planner: Object State Narrative Update

| Field | Value |
|---|---|
| Agent | Planner |
| Frequency | Per turn (conditional) |
| Conditional | Only if resolver_result.json → requires_narrative_update is true |

**System Prompt:**
- Instructions to append brief factual update to location narrator card
- Terse style — continuity reference, not narration

**Prompt Inputs:**
| Input | Source | Notes |
|---|---|---|
| Object state changes | resolver_result.json → object_state_changes[] | What changed |
| Location narrator card | location_narrator.md (affected location) | Existing content to append to |
| World primer | world_primer.md | Style reference |

**Output:** Appends update to location_narrator.md

**Cost Profile:** Cheap when it fires, but often doesn't fire at all. Simple state changes (locked → ajar) are handled by pure code templates in the State Manager — this LLM call is reserved for narratively complex changes only.

---

### Call 4 — Narrator: Continue Encounter

| Field | Value |
|---|---|
| Agent | Narrator |
| Frequency | Every turn |
| Conditional | No — always runs (unless encounter just resolved, in which case Call 8 runs instead) |

**System Prompt:**
- Narrator persona and voice instructions
- world_primer.md contents (embedded in system prompt for caching)

**Prompt Inputs — Always Loaded:**
| Input | Source | Notes |
|---|---|---|
| World primer | world_primer.md | In system prompt, cached |
| Current encounter brief | enc_XXX.md (including REVEALED sections) | Updated by Call 2 if applicable |
| Last encounter summary | session.json → last_encounter_summary | Previous encounter context |
| Conversation history | Turn-by-turn exchange | This encounter only |

**Prompt Inputs — Loaded On Demand:**
| Input | Source | Notes |
|---|---|---|
| NPC narrator cards | npc_narrator.md | Only NPCs active this encounter |
| Player narrator cards | player_narrator.md | All party members |
| Location narrator card | location_narrator.md | Current location |

**NEVER Loaded:**
| Input | Reason |
|---|---|
| arc_brief.md | Hidden story arc — planner only |
| npc_hidden.md (any NPC) | Hidden NPC info — planner only |
| campaign.json → resolution_conditions | Would cause narrator to steer toward outcomes |
| campaign.json → revelation_conditions | Would cause narrator to telegraph plot |
| campaign.json → location_secrets | Hidden location info — planner only |
| enc_XXX.md (future encounters) | Would leak future plot |

**Output:** Player-facing narration text

**Cost Profile:** Most frequently called agent. Largest variable input (conversation history grows each turn). System prompt + world_primer should be cached. NPC/player/location cards should be cached within an encounter since they change infrequently.

---

## Encounter Transition (fires once per encounter close)

These calls execute in strict sequence — each one's output feeds the next. They cannot be parallelized.

### Call 5 — Summarizer: Encounter Summary

| Field | Value |
|---|---|
| Agent | Summarizer |
| Frequency | Once per encounter close |
| Conditional | Only on encounter resolution |

**System Prompt:**
- Factual record-keeping instructions
- Past tense, no atmosphere
- Under 200 words

**Prompt Inputs:**
| Input | Source | Notes |
|---|---|---|
| Full encounter exchange | Turn-by-turn conversation | Entire completed encounter |
| Resolution outcome | resolver_result.json | Victory/failure/partial + notes |

**Output:** `enc_XXX_summary.md` (new file)

**Cost Profile:** Input size is bounded by encounter length. Single call per encounter — chosen over incremental per-turn summarization because: same total input tokens, smaller output, smaller downstream input to Call 6, lower per-call overhead. Tradeoff: sits in the critical path at encounter transition, adding latency.

---

### Call 6 — Planner: Reconciliation Pass

| Field | Value |
|---|---|
| Agent | Planner |
| Frequency | Once per encounter close |
| Conditional | Only on encounter resolution |

**System Prompt:**
- Post-encounter reconciliation instructions
- Output a structured JSON bundle of all updates
- Past tense, factual

**Prompt Inputs:**
| Input | Source | Notes |
|---|---|---|
| Encounter summary | enc_XXX_summary.md | From Call 5 (replaces full exchange) |
| Resolver result | resolver_result.json | Final resolution outcome |
| Arc brief | arc_brief.md | Arc-level implications |
| Completed encounter brief | enc_XXX.md | Full encounter including all REVEALED |
| NPC narrator cards | npc_narrator.md (all NPCs who appeared) | Current narrator-facing state |
| NPC hidden briefs | npc_hidden.md (all NPCs who appeared) | Hidden info for arc assessment |
| Player narrator cards | player_narrator.md (all party members) | Current behavioral record |
| Player state | player_state.json (all party members) | Structured tags and flags |
| Location narrator card | location_narrator.md (encounter location) | Current location state |
| Campaign world state | campaign.json → world_state | Current world flags |

**Output:** Structured JSON update bundle containing:
- NPC narrator card appends + state updates
- Player narrator card appends + state updates
- Location narrator card appends + state updates
- campaign.json world_state and progress updates
- List of conditions to mark as triggered

The orchestrator's State Manager fans these updates out to the correct files.

**Cost Profile:** Most expensive call in the system. Broadest context load. Using the encounter summary (from Call 5) instead of the full exchange is a critical optimization. Consider capping this further if token costs are a concern.

---

### Call 7 — Planner: Open Next Encounter

| Field | Value |
|---|---|
| Agent | Planner |
| Frequency | Once per encounter close |
| Conditional | Only on encounter resolution |

**System Prompt:**
- Encounter transition instructions
- Evaluate whether next encounter needs adjustment
- If far off-script, regenerate remaining encounters

**Prompt Inputs:**
| Input | Source | Notes |
|---|---|---|
| Completed encounter summary | enc_XXX_summary.md | What just happened |
| Next encounter brief | enc_XXX+1.md | To potentially adjust |
| Arc brief | arc_brief.md | Overall arc context |
| Campaign progress | campaign.json → progress, world_state | Current state |
| Player behavioral flags | player_state.json → planner_flags | How players are playing |

**Output:**
- enc_XXX+1.md (confirmed unchanged, or adjusted)
- campaign.json → current_encounter_id updated

If players are far off-arc:
- Remaining enc_XXX.md files regenerated
- arc_brief.md updated to reflect new path

**Cost Profile:** Medium. Mostly reads structured data plus two prose files. Output is usually small (confirmation + minor adjustments).

---

### Call 8 — Narrator: Open New Scene

| Field | Value |
|---|---|
| Agent | Narrator |
| Frequency | Once per encounter close |
| Conditional | Only on encounter resolution |

**System Prompt:**
- Same narrator system prompt as Call 4
- Additional instruction: acknowledge what just happened before setting new scene

**Prompt Inputs:**
| Input | Source | Notes |
|---|---|---|
| World primer | world_primer.md | In system prompt, cached |
| Completed encounter summary | enc_XXX_summary.md | Transition context |
| New encounter brief | enc_XXX+1.md | The scene to open |
| Player narrator cards | player_narrator.md (all party members) | Updated by Call 6 |
| NPC narrator cards | npc_narrator.md (NPCs in new encounter) | May include new NPCs |
| Location narrator card | location_narrator.md (new location) | New scene's location |

**Not Loaded:**
- No turn-by-turn history — fresh context window for new encounter

**Output:** Scene-opening narration → player-facing

**Cost Profile:** Similar to Call 4 but without conversation history. Clean context window.

---

## Call Frequency Summary

| Call | Per Turn | Per Encounter Close | Total per Encounter (20 turns) |
|---|---|---|---|
| 1 — Resolver | 1 | 0 | 20 |
| 2 — Planner revelation | 0-1 | 0 | ~2-4 |
| 3 — Planner object narrative | 0-1 | 0 | ~1-2 |
| 4 — Narrator continue | 1 | 0 | 20 |
| 5 — Summarizer | 0 | 1 | 1 |
| 6 — Planner reconciliation | 0 | 1 | 1 |
| 7 — Planner open next | 0 | 1 | 1 |
| 8 — Narrator open scene | 0 | 1 | 1 |
| **Total** | **2-4** | **4** | **~46-48** |

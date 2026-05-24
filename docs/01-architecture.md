# 01 — Architecture

## Core Architecture: The "DM Brain"

The system has two separate cognitive layers that never share context:

- **Planning Layer** (hidden from players): Generates the story arc, manages revelation timing, adjusts encounters based on player behavior.
- **Narration Layer** (player-facing): Sets scenes, responds to player actions, portrays NPCs. Only ever sees information the planner has explicitly released.

## Component Overview

### Agents (LLM-powered)

| Agent | Role | Player-facing? |
|---|---|---|
| Intake Agent | Conversational onboarding — gathers party profiles and campaign preferences | Yes (setup phase only) |
| Planner Agent | Arc generation, revelation appending, encounter adjustment, post-encounter reconciliation | Never |
| Resolver Agent | Evaluates player input against structured conditions, outputs JSON | Never |
| Narrator Agent | Scene setting, narration, NPC portrayal, player interaction | Yes (play phase) |
| Summarizer Agent | Produces factual encounter summary after encounter closes | Never |

### Pure Code Components

| Component | Role |
|---|---|
| Orchestrator (`index.js`) | Reads resolver output, calls agents in correct sequence, manages turn loop |
| State Manager (`stateManager.js`) | Mechanical JSON read/write operations — object states, NPC attitudes, player knowledge |

### Critical Rule: Only One Agent Is Player-Facing at a Time

During setup: the Intake Agent.
During play: the Narrator Agent.
The Planner, Resolver, and Summarizer are always background workers — they read files and write files but never talk to players directly.

## Tiered Context Loading

Never load everything into a single prompt. Each agent gets only what it needs.

```
TIER 1 — ALWAYS LOADED (narrator)
  Party player cards (compressed)
  Current encounter brief (enc_XXX.md)
  World primer (world_primer.md)
  Current encounter conversation history

TIER 2 — ON DEMAND (narrator, when relevant)
  NPC narrator cards (only active NPCs this encounter)
  Location narrator card (current location)
  Previous encounter summary (transition context)

TIER 3 — PLANNER ONLY (never reaches narrator)
  Full story arc (arc_brief.md)
  NPC hidden cards (npc_hidden.md)
  Unrevealed plot threads
  Future encounter briefs
  Victory/failure/partial resolution conditions
  Revelation conditions
  Location secrets
```

## Information Separation Principle

The planner knows everything. The narrator knows only what has been explicitly released. The resolver knows conditions to evaluate against but not narrative content. The orchestrator knows routing logic but no narrative content at all.

```
PLANNER reads:    Tier 1 + Tier 2 + Tier 3 (everything)
RESOLVER reads:   Structured conditions from campaign.json + player input + session state
NARRATOR reads:   Tier 1 + Tier 2 (never Tier 3)
ORCHESTRATOR:     Reads only structured JSON (resolver_result.json, session.json) — no prose
```

## Three-Tier Information Hierarchy (Per Encounter)

All encounter-related information falls into one of three tiers:

```
TIER 1 — enc_XXX.md (narrator reads from start)
  Scene setting, atmosphere, sensory detail
  What players know coming in
  Scene ingredients (who is here, what is present)
  REVEALED sections (appended by planner during play)

TIER 2 — campaign.json (resolver evaluates)
  Victory conditions
  Failure conditions
  Partial outcome conditions
  Revelation conditions and triggers
  Location secrets and their revelation conditions

TIER 3 — arc_brief.md (planner consults only)
  Why this encounter matters to the overall arc
  Hidden NPC motivations
  Future plot threads seeded here
  What a "good" vs "bad" outcome means for the arc
```

Each agent only reads its own tier and below. Nothing leaks upward.

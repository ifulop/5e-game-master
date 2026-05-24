# 08 — Information Flow

## Phase 1: Campaign Setup

```
User ◄──────────► Intake Agent
                    │
                    ▼
                intake.json
                    │
                    ▼
              Planner Agent (single non-interactive call)
                    │
                    ├──► campaign.json
                    ├──► arc_brief.md
                    ├──► world_primer.md
                    ├──► encounters/enc_001.md ... enc_NNN.md
                    ├──► npcs/[name]/[name]_narrator.md
                    ├──► npcs/[name]/[name]_hidden.md
                    ├──► npcs/[name]/[name]_state.json
                    ├──► locations/[name]/[name]_narrator.md
                    └──► locations/[name]/[name]_state.json
                    │
                    ▼
              Orchestrator (pure code)
                    │
                    ├──► session.json (created)
                    ├──► players/[name]/[name]_narrator.md (from intake.json)
                    └──► players/[name]/[name]_state.json (from intake.json)
                    │
                    ▼
              Narrator Agent ──► Opens first scene ──► Player sees narration
```

Key design point: The Intake Agent is the only player-facing agent during setup. The Planner is called once, non-interactively. It does not chat with anyone — it ingests intake.json and outputs all campaign files.

---

## Phase 2: Per-Turn Loop

```
Player Input
     │
     ▼
Orchestrator ──► Appends input to session.json
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│  CALL 1 — Resolver (always runs)                                │
│                                                                 │
│  Reads:                                                         │
│    player input (current turn)                                  │
│    session.json → player_inputs[]                               │
│    campaign.json → revelation_conditions[]                      │
│    campaign.json → resolution_conditions                        │
│    campaign.json → location_secrets → revelation_conditions[]   │
│    npc_state.json (active NPCs) → current_attitude              │
│                                                                 │
│  Writes:                                                        │
│    resolver_result.json                                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                    Orchestrator reads
                    resolver_result.json
                           │
              ┌────────────┴────────────┐
              │                         │
        Has triggers?            Has object changes
        or revelations?         needing prose?
              │                         │
             Yes                       Yes
              │                         │
              ▼                         ▼
┌──────────────────────┐  ┌──────────────────────┐
│ CALL 2 — Planner     │  │ CALL 3 — Planner     │
│ Revelation append    │  │ Object narrative     │
│                      │  │                      │
│ Reads:               │  │ Reads:               │
│  revelation_triggers │  │  object_state_changes│
│  arc_brief.md        │  │  location_narrator.md│
│  enc_XXX.md          │  │  world_primer.md     │
│  npc_hidden.md       │  │                      │
│  world_primer.md     │  │ Writes:              │
│                      │  │  location_narrator.md│
│ Writes:              │  │  (append)            │
│  enc_XXX.md (append) │  └──────────────────────┘
│  npc_narrator.md     │
│  (append)            │
│  campaign.json       │
│  (flag update)       │
└──────────────────────┘
              │
              │    State Manager also runs (pure code):
              │    ── applyObjectChanges → location_state.json
              │
              ▼
┌─────────────────────────────────────────────────────────────────┐
│  CALL 4 — Narrator (always runs)                                │
│                                                                 │
│  Reads:                                                         │
│    world_primer.md (cached in system prompt)                    │
│    enc_XXX.md (now updated if Call 2 ran)                       │
│    session.json → last_encounter_summary                        │
│    full turn-by-turn exchange (this encounter only)             │
│    npc_narrator.md (active NPCs — on demand)                   │
│    player_narrator.md (all party members — on demand)           │
│    location_narrator.md (current location — on demand)          │
│                                                                 │
│  Writes:                                                        │
│    narration text → player-facing response                      │
└─────────────────────────────────────────────────────────────────┘
```

Key design points:
- Calls 2 and 3 complete BEFORE Call 4 runs, so the narrator always reads updated files.
- The narrator's job never changes — it always just reads the brief and narrates.
- The planner controls what's in the brief; the narrator controls how it's presented.

---

## Phase 3: Encounter Transition

Triggered when resolver_result.json → resolution_triggered is not null.

```
Encounter resolves (resolver signals victory/failure/partial)
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│  CALL 5 — Summarizer                                            │
│                                                                 │
│  Reads:                                                         │
│    full turn-by-turn exchange (entire completed encounter)      │
│    resolver_result.json (final resolution outcome)              │
│                                                                 │
│  Writes:                                                        │
│    enc_XXX_summary.md (new file)                                │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  CALL 6 — Planner: Reconciliation Pass                          │
│                                                                 │
│  Reads:                                                         │
│    enc_XXX_summary.md (from Call 5 — NOT full exchange)         │
│    resolver_result.json                                         │
│    arc_brief.md                                                 │
│    enc_XXX.md (completed)                                       │
│    npc_narrator.md (all who appeared)                           │
│    npc_hidden.md (all who appeared)                             │
│    player_narrator.md (all party members)                       │
│    player_state.json (all party members)                        │
│    location_narrator.md (encounter location)                    │
│    campaign.json → world_state                                  │
│                                                                 │
│  Writes: structured JSON update bundle                          │
│    ──► State Manager fans out to:                               │
│        npc_narrator.md (post-encounter appends)                 │
│        npc_state.json (attitude, knowledge updates)             │
│        player_narrator.md (behavior, relationship appends)      │
│        player_state.json (tags, flags, knowledge updates)       │
│        location_narrator.md (post-encounter appends)            │
│        location_state.json (object state updates)               │
│        campaign.json (world_state, progress updates)            │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  CALL 7 — Planner: Open Next Encounter                          │
│                                                                 │
│  Reads:                                                         │
│    enc_XXX_summary.md (just completed)                          │
│    enc_XXX+1.md (next encounter, to potentially adjust)         │
│    arc_brief.md                                                 │
│    campaign.json → progress, world_state                        │
│    player_state.json → behavioral_tags, planner_flags           │
│                                                                 │
│  Writes:                                                        │
│    enc_XXX+1.md (confirmed or adjusted)                         │
│    campaign.json → current_encounter_id                         │
│    (if off-script: remaining enc files + arc_brief.md)          │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
              Orchestrator resets session.json
              (new encounter ID, clear inputs, reset turn count)
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  CALL 8 — Narrator: Open New Scene                              │
│                                                                 │
│  Reads:                                                         │
│    world_primer.md (cached in system prompt)                    │
│    enc_XXX_summary.md (transition context)                      │
│    enc_XXX+1.md (new encounter brief)                           │
│    player_narrator.md (all party members — updated by Call 6)   │
│    npc_narrator.md (NPCs in new encounter)                      │
│    location_narrator.md (new encounter location)                │
│                                                                 │
│  NO turn-by-turn history — fresh context window                 │
│                                                                 │
│  Writes:                                                        │
│    scene-opening narration → player-facing response             │
└─────────────────────────────────────────────────────────────────┘
```

---

## The Revelation Mechanism (Detail)

This is the core mechanism for how hidden information becomes narrator-visible.

```
campaign.json holds:
  revelation_conditions: [
    { id: "vesper_warden_hint",
      condition: "players offered protection to Vesper",
      reveals: "...",
      triggered: false }
  ]

      Player says: "We can protect you"
                │
                ▼
      Resolver evaluates condition text against player input
      using natural language understanding
                │
                ▼
      resolver_result.json:
        { revelation_triggers: ["vesper_warden_hint"] }
                │
                ▼
      Orchestrator reads triggers, calls Planner
                │
                ▼
      Planner reads:
        - The triggered condition's "reveals" content
        - npc_hidden.md (for context on what to surface)
        - arc_brief.md (for context on how it fits the story)
        - enc_XXX.md (to match prose style)
                │
                ▼
      Planner appends to enc_XXX.md:
        ## REVEALED — Turn 3
        [Approved content in narrator-appropriate prose]
                │
                ▼
      State Manager marks condition triggered in campaign.json
                │
                ▼
      Narrator reads enc_XXX.md (now includes REVEALED section)
      Incorporates new content naturally into narration
```

The narrator never knows what's coming — it can only narrate what's currently in its files. The planner is the gatekeeper that decides what to release and when. The resolver evaluates whether conditions have been met. The orchestrator routes between them.

---

## Data Flow Summary: Who Writes What

| Writer | Files Written |
|---|---|
| Intake Agent | intake.json |
| Planner Agent | campaign.json, arc_brief.md, world_primer.md, enc_XXX.md (create + append), npc_narrator.md (create + append), npc_hidden.md (create + update), npc_state.json (create), location_narrator.md (create + append), location_state.json (create) |
| Resolver Agent | resolver_result.json |
| Narrator Agent | narration text (player-facing output only — writes no files) |
| Summarizer Agent | enc_XXX_summary.md |
| Orchestrator | session.json, player_narrator.md (initial creation from intake), player_state.json (initial creation from intake) |
| State Manager | npc_state.json (updates), player_state.json (updates), location_state.json (updates), campaign.json (flag/progress updates), npc_narrator.md (append from reconciliation bundle), player_narrator.md (append from reconciliation bundle), location_narrator.md (append from reconciliation bundle) |

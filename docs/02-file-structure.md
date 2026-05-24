# 02 — File Structure

## Complete Project Layout

```
dm-agent/
├── index.js                         # Orchestrator — pure code, manages turn loop
├── stateManager.js                  # Pure code utility — JSON read/write operations
├── agents/
│   ├── intake.js                    # Intake Agent — onboarding conversation
│   ├── planner.js                   # Planner Agent — arc generation, revelations, reconciliation
│   ├── resolver.js                  # Resolver Agent — condition evaluation
│   ├── narrator.js                  # Narrator Agent — scene setting, player interaction
│   └── summarizer.js                # Summarizer Agent — end-of-encounter factual summary
├── prompts/
│   ├── intake_system.txt            # System prompt for Intake Agent
│   ├── planner_system.txt           # System prompt for Planner Agent
│   ├── planner_revelation.txt       # System prompt for Planner revelation append calls
│   ├── planner_reconciliation.txt   # System prompt for Planner post-encounter reconciliation
│   ├── planner_open_encounter.txt   # System prompt for Planner encounter transition
│   ├── resolver_system.txt          # System prompt for Resolver Agent
│   ├── narrator_system.txt          # System prompt for Narrator Agent
│   └── summarizer_system.txt        # System prompt for Summarizer Agent
├── campaign/                        # All campaign state — generated at session start
│   ├── campaign.json                # Master state + all hidden conditions
│   ├── intake.json                  # Captured player preferences (output of intake phase)
│   ├── session.json                 # Current session progress tracker
│   ├── resolver_result.json         # Latest resolver output (overwritten each turn)
│   ├── arc_brief.md                 # Full story arc — PLANNER ONLY, never shown to players
│   ├── world_primer.md              # World atmosphere and tone — loaded into narrator always
│   ├── encounters/
│   │   ├── enc_001.md               # Encounter brief — narrator reads this
│   │   ├── enc_001_summary.md       # Post-encounter factual summary
│   │   ├── enc_002.md
│   │   ├── enc_002_summary.md
│   │   └── ...
│   ├── locations/
│   │   ├── tinder_box_tavern/
│   │   │   ├── tavern_narrator.md   # Atmosphere, layout, objects — narrator reads this
│   │   │   └── tavern_state.json    # Object states, visit history — code queries this
│   │   ├── pier_9_wharf/
│   │   │   ├── wharf_narrator.md
│   │   │   └── wharf_state.json
│   │   └── ...
│   ├── npcs/
│   │   ├── vesper/
│   │   │   ├── vesper_narrator.md   # Appearance, known facts, relationships — narrator reads
│   │   │   ├── vesper_hidden.md     # True identity, future arc, locked revelations — PLANNER ONLY
│   │   │   └── vesper_state.json    # Attitude, knowledge tracking — code queries this
│   │   └── ...
│   └── players/
│       ├── aria/
│       │   ├── aria_narrator.md     # Profile, behaviors, relationships — narrator reads
│       │   └── aria_state.json      # Behavioral tags, planner flags, knowledge — code queries
│       └── ...
└── package.json
```

## File Access Matrix

This matrix defines which component can read each file. Violations of this matrix would leak hidden information to players.

| File | Orchestrator | State Manager | Resolver | Planner | Narrator | Summarizer |
|---|---|---|---|---|---|---|
| `campaign.json` | READ | READ/WRITE | READ (conditions only) | READ/WRITE | NEVER | NEVER |
| `session.json` | READ/WRITE | READ/WRITE | READ | READ | NEVER | NEVER |
| `resolver_result.json` | READ | NEVER | WRITE | READ | NEVER | NEVER |
| `intake.json` | READ | NEVER | NEVER | READ | NEVER | NEVER |
| `arc_brief.md` | NEVER | NEVER | NEVER | READ/WRITE | NEVER | NEVER |
| `world_primer.md` | NEVER | NEVER | NEVER | READ | READ | NEVER |
| `enc_XXX.md` | NEVER | NEVER | NEVER | READ/WRITE | READ | NEVER |
| `enc_XXX_summary.md` | NEVER | NEVER | NEVER | READ | READ (transition only) | WRITE |
| `npc_narrator.md` | NEVER | NEVER | NEVER | READ/WRITE | READ | NEVER |
| `npc_hidden.md` | NEVER | NEVER | NEVER | READ/WRITE | NEVER | NEVER |
| `npc_state.json` | NEVER | READ/WRITE | READ (attitude only) | READ | NEVER | NEVER |
| `player_narrator.md` | NEVER | NEVER | NEVER | READ/WRITE | READ | NEVER |
| `player_state.json` | NEVER | READ/WRITE | NEVER | READ | NEVER | NEVER |
| `location_narrator.md` | NEVER | NEVER | NEVER | READ/WRITE | READ | NEVER |
| `location_state.json` | NEVER | READ/WRITE | NEVER | READ | NEVER | NEVER |

## File Format Rules

- **JSON files**: Data that code needs to query or mutate. Deterministic parsing, field-level access, easy partial updates.
- **Markdown files**: Prose that LLMs need to read and narrate from. Rich enough to guide tone and style.
- **Hybrid**: Some JSON files contain markdown strings inside fields (e.g., `last_encounter_summary_md` in session.json). This gives clean code access to the data structure while providing clean prose when spliced into prompts.

## File Lifecycle

### Generated Once at Campaign Start (by Planner)
- `campaign.json`
- `arc_brief.md`
- `world_primer.md`
- All `enc_XXX.md` files
- All `npc_narrator.md` files
- All `npc_hidden.md` files
- All `npc_state.json` files
- All `location_narrator.md` files
- All `location_state.json` files

### Generated Once at Campaign Start (by Intake Agent)
- `intake.json`

### Generated Once at Campaign Start (by Orchestrator)
- `session.json`
- All `player_narrator.md` files (from intake.json party data)
- All `player_state.json` files (from intake.json party data)

### Updated During Play
- `campaign.json` — progress, world_state, triggered flags (by State Manager + Planner)
- `session.json` — player_inputs, current status (by Orchestrator)
- `resolver_result.json` — overwritten every turn (by Resolver)
- `enc_XXX.md` — REVEALED sections appended (by Planner)
- `npc_narrator.md` — REVEALED sections + post-encounter updates (by Planner)
- `npc_state.json` — attitude, knowledge (by State Manager)
- `player_narrator.md` — behaviors, relationships (by Planner)
- `player_state.json` — behavioral_tags, planner_flags, knowledge (by State Manager)
- `location_narrator.md` — REVEALED sections + post-encounter updates (by Planner)
- `location_state.json` — object states (by State Manager)

### Generated Once Per Encounter Close (by Summarizer)
- `enc_XXX_summary.md`

### Potentially Regenerated Mid-Campaign (by Planner)
- Future `enc_XXX.md` files (if players go far off-script)
- `arc_brief.md` (if replanning is needed)

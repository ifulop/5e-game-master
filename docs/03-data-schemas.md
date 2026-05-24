# 03 — Data Schemas

## campaign.json

The master state file. Contains all hidden conditions, progress tracking, and world state. Read by the orchestrator and planner. The resolver reads only the conditions subsections. The narrator NEVER reads this file.

```json
{
  "meta": {
    "campaign_id": "uuid-string",
    "title": "The Shadow Compact",
    "created_at": "2025-05-23T00:00:00Z",
    "estimated_duration_hours": 3.5,
    "arc_length": 5
  },

  "tone": {
    "mood": "dark with moments of levity",
    "pacing": "slow-burn",
    "combat_ratio": 0.3,
    "narrative_style": "noir-political"
  },

  "arc": {
    "premise": "A conspiracy within the city guard threatens to destabilize Valdenmere",
    "central_conflict": "The players must expose a corrupt magistrate before he destroys evidence",
    "final_revelation": "The magistrate answers to a shadow council that controls the city",
    "themes": ["corruption", "loyalty", "sacrifice"]
  },

  "encounters": [
    {
      "id": "enc_001",
      "index": 0,
      "title": "The Burning Tavern",
      "status": "completed",
      "outcome": "success",
      "revelation_conditions": [
        {
          "id": "tavern_ledger_found",
          "condition": "players search the tavern or the bar area",
          "reveals": "A suspicious ledger is found behind the bar, with entries showing regular payments to an unnamed city official",
          "triggered": true
        }
      ],
      "resolution_conditions": {
        "victory": {
          "condition": "players escape the tavern with the ledger",
          "triggered": true
        },
        "failure": {
          "condition": "players flee without investigating, or the tavern collapses before they search",
          "triggered": false
        },
        "partial": {
          "condition": "players escape but without the ledger",
          "triggered": false
        }
      }
    },
    {
      "id": "enc_002",
      "index": 1,
      "title": "The Dockside Informant",
      "status": "current",
      "outcome": null,
      "revelation_conditions": [
        {
          "id": "vesper_warden_hint",
          "condition": "players have offered protection or safe passage to Vesper",
          "reveals": "Vesper mentions someone called 'The Warden' — a figure she is clearly terrified of. She will not elaborate further unless pressed, and pressing her risks her bolting.",
          "triggered": false
        },
        {
          "id": "enc_002_transition",
          "condition": "victory condition met — players know about Harbormaster Collen",
          "reveals": "Vesper presses a crumpled gala invitation into Aria's hand before disappearing into the fog. The invitation is for the Magistrate's estate, three nights hence.",
          "triggered": false
        }
      ],
      "resolution_conditions": {
        "victory": {
          "condition": "players leave with knowledge of Harbormaster Collen's involvement",
          "triggered": false
        },
        "failure": {
          "condition": "Vesper flees without talking, or players are spotted by the patrol and must run",
          "triggered": false
        },
        "partial": {
          "condition": "players learn about the docks connection but not Collen specifically",
          "triggered": false
        }
      }
    },
    {
      "id": "enc_003",
      "index": 2,
      "title": "The Magistrate's Gala",
      "status": "upcoming",
      "outcome": null,
      "revelation_conditions": [],
      "resolution_conditions": {
        "victory": { "condition": "...", "triggered": false },
        "failure": { "condition": "...", "triggered": false },
        "partial": { "condition": "...", "triggered": false }
      }
    }
  ],

  "location_secrets": {
    "pier_9_wharf": {
      "hidden_facts": [
        "The harbormaster's office contains a second ledger linking payments to the magistrate",
        "Vesper has a hidden cache beneath finger dock 3 — she will only reveal this if trust is high"
      ],
      "revelation_conditions": [
        {
          "id": "office_ledger_found",
          "condition": "players enter and search the harbormaster's office",
          "reveals": "A second ledger is found inside, matching entries in the tavern ledger but with the recipient identified as 'Magistrate Harken'",
          "triggered": false
        }
      ]
    }
  },

  "progress": {
    "current_encounter_index": 1,
    "current_encounter_id": "enc_002",
    "session_status": "awaiting_player_input",
    "revealed_plot_threads": ["enc_001_ledger_clue"],
    "unrevealed_plot_threads": ["shadow_council", "magistrate_identity"]
  },

  "world_state": {
    "npc_attitudes": {
      "guard_captain_rourke": "hostile",
      "informant_vesper": "cautious"
    },
    "items_in_play": ["tavern_ledger"],
    "locations_visited": ["the_tinder_box_tavern"],
    "flags": {
      "players_know_about_ledger": true,
      "magistrate_alerted": false
    }
  },

  "files": {
    "arc_brief": "arc_brief.md",
    "world_primer": "world_primer.md",
    "encounters_dir": "encounters/",
    "npcs_dir": "npcs/",
    "locations_dir": "locations/",
    "players_dir": "players/"
  }
}
```

## intake.json

Output of the Intake Agent. Consumed by the Planner to generate the campaign. Never shown to players after creation.

```json
{
  "party": [
    {
      "name": "Aria",
      "class": "Rogue",
      "personality": "sardonic, distrustful of authority",
      "backstory_hook": "fleeing a thieves guild in her home city",
      "playstyle_notes": "player prefers cunning over confrontation"
    },
    {
      "name": "Brom",
      "class": "Fighter",
      "personality": "loyal, straightforward, protective",
      "backstory_hook": "former city guard who left under unclear circumstances",
      "playstyle_notes": "player enjoys direct action and moral choices"
    }
  ],
  "preferences": {
    "tone": "dark with moments of levity",
    "primary_goal": "uncover a political conspiracy",
    "time_available": "3-4 hours",
    "combat_ratio": 0.3,
    "problem_solving_preference": "investigation and social encounters",
    "content_limits": ["no horror involving children"]
  }
}
```

## session.json

Tracks current session progress. Updated by the orchestrator every turn.

```json
{
  "campaign_id": "uuid-string",
  "current_encounter_index": 1,
  "current_encounter_id": "enc_002",
  "encounter_status": "awaiting_player_input",
  "turn_count": 4,
  "player_inputs": [
    "We approach the wharf cautiously, staying in the shadows",
    "I whisper to Vesper that we found her name in the ledger",
    "Aria says: We can protect you. Come with us.",
    "We duck behind the fish crates when the patrol passes"
  ]
}
```

## resolver_result.json

Output of the Resolver Agent each turn. Overwritten on every turn. Read by the orchestrator to determine routing.

```json
{
  "encounter_id": "enc_002",
  "turn": 4,
  "revelation_triggers": [
    "vesper_warden_hint"
  ],
  "resolution_triggered": null,
  "object_state_changes": [
    {
      "location": "pier_9_wharf",
      "object_id": "fish_crates",
      "new_state": "disturbed",
      "interacted_by": "party",
      "interaction": "concealed behind during guard patrol"
    }
  ],
  "npc_attitude_changes": [
    {
      "npc_id": "vesper",
      "previous_attitude": "cautious",
      "new_attitude": "frightened",
      "reason": "Party pressed her for the Warden's name despite visible reluctance"
    }
  ],
  "encounter_continues": true,
  "requires_narrative_update": true,
  "notes": "Player offered Vesper safe passage — warden hint condition met. Fish crates disturbed — simple state change, template-able."
}
```

The `requires_narrative_update` field distinguishes object state changes that need planner prose judgment from those that can be handled by a pure code template in the state manager.

The `npc_attitude_changes` array is populated whenever the resolver determines that player actions warrant a mid-turn attitude shift for one or more active NPCs. Each entry records the previous state for audit purposes. An empty array (`[]`) means no attitude shifts this turn. The state manager processes this array before the narrator runs, appending a brief factual note to the relevant `npc_narrator.md` so the updated attitude is visible to the narrator on the same turn.

**Attitude values:** `frightened` | `hostile` | `neutral` | `cautious` | `cooperative`

The resolver may transition any NPC between any two of these five states in a single turn. Transitions are not constrained to adjacent states — a cooperative NPC can become hostile in one turn if the narrative warrants it. The planner sets the initial attitude (from `unknown` to any of the five) at campaign generation time.

## npc_state.json

Per-NPC structured state. Updated by State Manager.

```json
{
  "npc_id": "vesper",
  "first_appeared": "enc_002",
  "current_attitude": "cautious",
  "attitude_history": [
    { "encounter": "enc_002", "turn": 1, "attitude": "frightened" },
    { "encounter": "enc_002", "turn": 3, "attitude": "cautious" }
  ],
  "knowledge_revealed": [
    "knows_about_ledger_payments",
    "knows_about_docks_connection"
  ],
  "knowledge_locked": [
    "warden_identity",
    "secondary_ledger_location",
    "aria_guild_connection"
  ],
  "alive": true,
  "location": "unknown",
  "will_reappear": true,
  "scheduled_reappearance": "enc_004"
}
```

## player_state.json

Per-player structured state. Updated by State Manager.

```json
{
  "player_id": "aria",
  "class": "rogue",
  "behavioral_tags": [
    "prefers_deception",
    "shows_mercy_to_frightened_npcs",
    "avoids_authority_figures"
  ],
  "relationships": {
    "vesper": "cautious_respect",
    "guard_captain_rourke": "hostile_recognized"
  },
  "knowledge": [
    "ledger_guard_connection",
    "vesper_docks_link",
    "holds_gala_invitation"
  ],
  "planner_flags": [
    "mercy_shown_count: 2",
    "combat_avoided_count: 3"
  ]
}
```

The `behavioral_tags` and `planner_flags` fields give the planner structured signals to act on. For example, `mercy_shown_count: 2` can be evaluated when deciding whether to introduce a moral dilemma encounter. These signals cannot be reliably extracted from prose summaries.

## location_state.json

Per-location structured state. Updated by State Manager.

```json
{
  "location_id": "pier_9_wharf",
  "first_appeared": "enc_002",
  "times_visited": 1,
  "last_visited": "enc_002",
  "atmosphere_tags": ["dark", "isolated", "industrial", "coastal"],

  "objects": [
    {
      "id": "harbormaster_door",
      "label": "Harbormaster's office door",
      "initial_state": "locked",
      "current_state": "ajar",
      "interacted_by": "aria",
      "interaction": "lockpicked",
      "encounter": "enc_002",
      "planner_flag": "office_interior_unexplored"
    },
    {
      "id": "fish_crates",
      "label": "Stack of fish crates",
      "initial_state": "neatly stacked",
      "current_state": "disturbed",
      "interacted_by": "party",
      "interaction": "concealed behind during guard patrol",
      "encounter": "enc_002",
      "planner_flag": null
    },
    {
      "id": "broken_lantern",
      "label": "Broken lantern post",
      "initial_state": "unlit",
      "current_state": "unlit",
      "interacted_by": null,
      "interaction": null,
      "encounter": null,
      "planner_flag": null
    }
  ],

  "npcs_associated": ["vesper", "harbormaster_collen"],
  "encounter_history": ["enc_002"],

  "world_state_flags": {
    "guard_patrol_aware_of_disturbance": false,
    "harbormaster_office_breached": true,
    "vesper_meeting_point_known_to_guards": false
  }
}
```

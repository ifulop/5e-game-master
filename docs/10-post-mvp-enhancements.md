# 10 — Post-MVP Enhancements

A running log of features explicitly deferred from MVP scope. Items here are acknowledged, not forgotten. Each entry includes a brief rationale for deferral and enough context to pick up the idea when the time comes.

---

## Session Persistence

**What it is:** Save campaign state between sessions so players can close the browser and resume exactly where they left off — same encounter, same NPC attitudes, same world state.

**Why deferred:** MVP uses a single session with no persistence. All campaign state lives in memory (JSON files on disk scoped to a single process). Adding persistence requires a storage layer decision (database vs. serialized files), session identity/auth, and a resume flow in the UI.

**When it's needed:** The moment campaigns run longer than one sitting, or the product is used by anyone other than the developer.

**Implementation notes:**
- MongoDB is already noted as the likely persistence layer (see `CLAUDE.md`)
- The file-based state architecture maps cleanly to document storage — `campaign.json`, `session.json`, all state files become documents keyed by `campaign_id`
- The resume flow needs a landing page change: "Start new" vs "Resume campaign" with a campaign list
- Session identity will need at minimum a browser-local token or a simple login

---

## Voice Recognition for Input

**What it is:** Players speak their actions and dialogue aloud instead of typing. Speech is transcribed and fed into the turn loop as player input.

**Why deferred:** Adds an external API dependency (e.g. Web Speech API or Whisper), introduces latency at the input stage, and requires UI affordances (push-to-talk, transcription display, edit-before-submit). Core loop works without it.

**Implementation notes:**
- Web Speech API is available natively in Chrome with no backend dependency — lowest-friction starting point
- Whisper API (via OpenAI or self-hosted) provides higher accuracy, especially for fantasy proper nouns (NPC names, spells, locations)
- The transcription should be displayed to the player before submission so they can catch errors — fantasy vocabulary trips up speech recognition frequently
- Multi-player voice (each player on their own mic) is a separate, harder problem — don't conflate with single-typist voice

---

## Voice Narration for Output

**What it is:** The narrator's text output is spoken aloud by a text-to-speech voice, creating an audiobook-style DM experience.

**Why deferred:** Adds TTS API dependency, narration latency, and significant UX decisions (auto-play vs. play button, voice character, speed controls, skip/pause). Nice to have; not core to the game loop.

**Implementation notes:**
- ElevenLabs or Play.ht for high-quality, characterful voices — worth it for a DM persona
- Web Speech API `SpeechSynthesisUtterance` is zero-cost but sounds robotic — acceptable for prototype
- Voice should be consistent with tone: a dark noir-political campaign needs a different voice than a whimsical adventure
- Streamed narration (read aloud as tokens arrive) is technically complex but dramatically better UX — text streams in and is spoken in real time rather than waiting for the full response
- NPC voices: different voice profiles per NPC would be extraordinary but is a significant implementation lift

---

## Battle Engine

**What it is:** A structured combat subsystem that handles initiative order, hit rolls, damage, spell effects, and conditions — replacing the current free-form narration of combat encounters with turn-based mechanical resolution.

**Why deferred:** The current system handles combat through the narrator's prose, with the resolver evaluating combat outcomes as conditions (e.g. "players defeat the guards"). This is intentionally abstract. A full battle engine is a large parallel system.

**Implementation notes:**
- Would require a new agent or subsystem: a Combat Resolver that tracks HP, conditions, initiative, and action economy
- The narrator would need to understand combat state (who is down, what conditions are active) — a new `combat_state.json` file and narrator card updates
- 5e RPG rules are the natural target ruleset; consider whether to implement them faithfully or use a simplified abstraction
- Integration point: the orchestrator's turn loop would need a "combat mode" branch where the combat resolver runs instead of (or before) the regular resolver
- Battle maps / grid visualization would be a further enhancement on top of this

---

## Image Generation for Narration

**What it is:** Key narrative moments — scene openings, NPC introductions, dramatic revelations — are accompanied by AI-generated images that illustrate the narration.

**Why deferred:** Adds image generation API dependency, significant latency (image gen is slow), cost per image, and UI layout changes to accommodate images alongside text. Also requires prompt engineering to produce consistent art style across a campaign.

**Implementation notes:**
- Trigger points: scene opening (Call 8), major revelation moments (REVEALED section appended), campaign epilogue
- Prompt construction: the planner or narrator would need to produce an image prompt alongside its text output — a structured field in the response, not embedded in prose
- Style consistency is the hard problem — characters and locations should look the same across multiple generated images. Techniques: style reference images, LoRA fine-tuning, or detailed style prompts locked to the campaign
- DALL-E 3 or Stable Diffusion via API are the natural candidates
- Consider async generation: trigger image gen in parallel with narrator call, display text immediately, image appears when ready
- Storage: generated images need to be stored and associated with campaign/encounter — another reason persistence needs to come first

---

## Text-to-Soundscape for Narrative Enhancement

**What it is:** Ambient audio — environmental sounds, atmospheric music, tension cues — that plays underneath the narration and adapts dynamically to the current scene. A tavern encounter sounds different from a dockside meeting at night; a revelation moment carries a different sonic texture than routine dialogue.

**Why deferred:** Adds an external API dependency, requires audio playback UI, and introduces complex decisions around when and how soundscapes transition. The narration loop works without it; this is atmospheric enhancement.

**When it's needed:** When the experience is mature enough that immersion, not functionality, is the primary improvement lever.

**Implementation notes:**
- Candidate APIs: ElevenLabs Sound Effects, Soundraw, or Mubert for AI-generated adaptive audio; also worth evaluating Suno for scene-matched generative music
- Trigger points mirror the narrator's cadence — soundscape should shift at scene open (Call 8), during major revelations (REVEALED append), and at encounter resolution
- The planner or narrator would need to output a structured `soundscape_tag` (e.g. `"dockside_night_tense"`) alongside narration text, rather than embedding audio cues in prose — keeps the audio layer decoupled from narrative logic
- Crossfade logic between soundscapes needs careful handling to avoid jarring cuts mid-narration
- Volume ducking during narrator text output (auto-lower ambient audio when new narration arrives) significantly improves listenability
- Pairs naturally with Voice Narration — the two features together create a fully immersive audio experience; consider implementing them together rather than sequentially
- Consider a player-facing volume control and a "soundscape off" toggle — not everyone wants ambient audio

---

## Character Sheets (Players and NPCs)

**What it is:** Full structured stat blocks for player characters and a lighter variant for NPCs — covering core attributes (Strength, Dexterity, Constitution, Intelligence, Wisdom, Charisma), derived values (HP, AC, saving throws, skill modifiers), equipment, and for players, class-specific fields like spell slots. The exact schema for both is undecided and deferred; this entry maps where the current design will need to change when sheets arrive.

**Why deferred:** The scope of 5e RPG character mechanics is large, and the right level of fidelity (full 5e vs. a narrative-plus abstraction) hasn't been decided. Building the probabilistic engine and battle engine first will clarify exactly which stat fields are actually needed, making the schema decision easier to get right.

**Impact on current design — files that will change:**

- `player_state.json` — currently tracks behavioral tags, relationships, knowledge, and planner flags. Stat fields (attributes, HP, equipment, etc.) will be added here. The schema in `03-data-schemas.md` will need a new `sheet` block.
- `npc_state.json` — currently tracks attitude, knowledge, and encounter history. Will need a lighter `sheet` block (HP, key abilities, relevant stats) for NPCs who appear in combat. Social-only NPCs may remain minimal.
- `intake.json` — the Intake Agent currently captures class and personality but not stats. It will need to either gather starting stats from players or signal the Planner to generate them.
- `players/[name]/[name]_narrator.md` — may need a condensed stat summary so the Narrator can reference HP and conditions during narration without loading the full JSON.

**Impact on current design — agents and components that will change:**

- **Intake Agent** — will need to gather or prompt for starting stat values. Alternatively, the Planner generates stats from class and backstory and the Intake Agent just captures class — a design decision to make at implementation time.
- **Planner Agent** — will need to assign NPC stat blocks at campaign generation time, at minimum for NPCs flagged as combat-relevant.
- **Resolver Agent** — the probabilistic engine (see below) will pull stat modifiers from `player_state.json` and `npc_state.json`. The resolver's input contract will need to include relevant stat fields when evaluating skill-check-style conditions.
- **State Manager** — HP changes, condition tracking (poisoned, restrained, etc.), and equipment changes will all route through the State Manager as structured updates alongside the existing attitude and object change handlers.

**NPC sheets will be lighter than player sheets.** The exact fields are deferred, but the guiding principle is: NPCs need enough mechanical data to participate in the probabilistic engine and battle engine, not enough to fully replicate a player character. Social-only NPCs may carry no sheet at all.

---

## Probabilistic Engine

**What it is:** A standalone pure-code utility (`probabilityEngine.js`) that evaluates uncertain outcomes by combining a base probability with a stat modifier and a dice roll. It sits alongside `stateManager.js` as a shared utility callable by the orchestrator and, later, the battle engine. The resolver (and battle engine) identify when an action is genuinely uncertain rather than a hard success or failure, supply a base probability and the relevant stat, and the engine resolves the outcome and returns a structured result for audit.

**Why deferred:** Requires character sheet stat fields to exist before stat modifiers can be applied. Also requires a design decision on how the resolver's output schema changes — currently all conditions are binary (triggered / not triggered); uncertain conditions need a different treatment.

**Core mechanic (proposed):**

The engine receives a base probability (0–100, supplied by the caller based on narrative context), a stat modifier (derived from the relevant character sheet field — e.g. Dexterity modifier for a lockpick attempt), and optionally a difficulty class. It applies the modifier, rolls, and returns a boolean outcome plus the full roll details for the audit log.

```
probabilityEngine.roll({
  base_probability: 60,       // caller's narrative assessment
  stat_modifier: +3,          // from player_state.json sheet field
  difficulty_class: 15,       // optional, for 5e RPG-style DC checks
  context: "aria_lockpick_attempt"
})
→ { success: true, roll: 14, modified_roll: 17, dc: 15, context: "..." }
```

**Open design question — resolver output schema:** The resolver currently outputs binary `revelation_triggers[]` and `resolution_triggered`. Probabilistic outcomes sit between these: the action is neither a clear success nor a clear failure, but the resolver can assess a likelihood. Two options to decide at implementation time: (a) the resolver adds a `probabilistic_checks[]` array to its output, each entry carrying a base probability and stat key, and the orchestrator calls the engine before routing; or (b) the resolver calls the engine directly and returns a resolved boolean alongside its normal output. Option (a) keeps the resolver as a pure evaluator consistent with its current design principle.

**Use cases in the existing turn loop:**

- **NPC attitude shifts** — currently the resolver makes a binary judgment on whether an attitude changes. With the engine, ambiguous interactions (a half-convincing argument, a bribe that might or might not land) can be resolved probabilistically using the relevant player stat (Charisma modifier for persuasion attempts).
- **Object interaction outcomes** — lockpicking, forced entry, sleight of hand — currently narrated abstractly. The engine provides a mechanical resolution that feeds into `object_state_changes[]`.

**Use cases in the battle engine (future):** Hit rolls, saving throws, spell resistance, and skill checks during combat are all natural consumers of the same utility. Designing it as a standalone now avoids duplicating dice logic when the battle engine is built.

**Implementation notes:**
- The engine is pure code — no LLM calls. Randomness source should be seeded and logged for reproducibility and debugging.
- Roll results should be appended to a `rolls[]` log in `session.json` or a separate `rolls.json` for audit and replay.
- The stat modifier mapping (which stat applies to which action type) will need a lookup table or convention — e.g. lockpicking → Dexterity, persuasion → Charisma, forced door → Strength. This mapping can live in a config file rather than being hardcoded.

---

## 2D Battle Map

**What it is:** A grid-based spatial representation of combat encounters — tracking the position of players, NPCs, and terrain features (walls, obstacles, cover) on a 2D coordinate system. The Planner generates the map at campaign creation time for combat-flagged encounters. A new pure-code utility (`battleMap.js`) manages position reads and writes during combat sequences.

**Why deferred:** Depends on character sheets (movement speed, reach, and area-of-effect ranges all require stat data) and is most useful once the battle engine exists to consume it. The rendering approach — ASCII terminal output, a JSON state file for a future frontend, or a browser-rendered UI — is also undecided and deferred.

**Map generation — Planner's responsibility:**

For each encounter flagged as a combat encounter, the Planner generates a `battle_map.json` file at campaign creation time alongside the encounter brief. The Planner derives the map from the location description in `location_narrator.md` — translating prose layout (a long narrow wharf, a circular tavern common room) into a grid with dimensions, terrain objects, and initial entity positions.

```json
{
  "encounter_id": "enc_002",
  "grid": { "width": 20, "height": 12, "scale": "5ft_per_square" },
  "terrain": [
    { "id": "fish_crates", "type": "cover", "squares": [[3,4],[3,5],[4,4]] },
    { "id": "harbormaster_wall", "type": "impassable", "squares": [[0,0],[1,0],[2,0]] }
  ],
  "entities": [
    { "id": "aria", "type": "player", "position": [8, 6] },
    { "id": "vesper", "type": "npc", "position": [10, 4] },
    { "id": "guard_patrol", "type": "npc", "position": [15, 9] }
  ]
}
```

**Impact on current design — files that will change:**

- `encounters/enc_XXX.md` — the Planner's system prompt for arc generation will need to include instructions to produce `battle_map.json` for combat encounters alongside the encounter brief.
- `campaign/encounters/` directory — will gain `enc_XXX_battle_map.json` files for combat encounters.
- `location_state.json` — object positions tracked here will need to be reconcilable with grid coordinates. A `grid_position` field on location objects is one approach.
- The file structure in `02-file-structure.md` and access matrix will need updating when implemented — `battle_map.json` is readable by the battle engine and orchestrator, not the narrator directly.

**Impact on current design — agents and components that will change:**

- **Planner Agent** — arc generation prompt will need instructions to identify combat encounters and produce grid layouts from location prose descriptions.
- **Orchestrator** — the existing turn loop will need a combat mode branch (already noted in the Battle Engine entry). In combat mode, `battleMap.js` position updates run after each turn alongside the existing State Manager updates.
- **Narrator Agent** — will not read `battle_map.json` directly (consistent with the principle that the narrator reads prose, not structured data). Instead, the orchestrator or a new combat narrator card will translate current grid state into a prose summary that the narrator can incorporate — e.g. "Aria is near the fish crates; the guard patrol is at the far end of the dock."

**`battleMap.js` utility responsibilities:**
- Read and write entity positions
- Validate moves (check for impassable terrain, grid bounds)
- Calculate distances between entities (for range checks, movement cost)
- Return a structured snapshot of current positions for the narrator prose summary

**Open design question — rendering:** Whether the map is printed as ASCII to the terminal, serialized as JSON for a future frontend renderer, or rendered as a browser UI widget is undecided. The `battle_map.json` state file is frontend-agnostic by design — all three rendering approaches can consume it. This decision can be made when the battle engine is built.

**Dependency chain:** Character sheets must exist first (movement speed determines how far an entity can move per turn; reach and range determine valid attack targets). The battle engine is the primary consumer of map state and should be scoped and built together with this feature rather than sequentially.

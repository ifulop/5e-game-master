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
- D&D 5e rules are the natural target ruleset; consider whether to implement them faithfully or use a simplified abstraction
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

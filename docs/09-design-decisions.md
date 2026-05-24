# 09 — Design Decisions

A chronological log of every architectural decision made during design, with the rationale for each choice and the alternatives that were considered and rejected.

---

## Decision 1: Two Cognitive Layers (Planning vs Narration)

**Choice:** Separate the system into a hidden Planning Layer and a player-facing Narration Layer that never share context.

**Rationale:** Putting hidden story information in the narrator's context creates multiple failure modes — LLMs can leak hidden information through implication, foreshadowing, or simply ignoring instructions under long context. Separating the layers makes narrator behavior more reliable and keeps the planner genuinely in control of pacing.

**Rejected alternative:** Single agent with instructions to "not reveal" hidden content. Rejected because instruction-following for information suppression is fragile, especially as context grows.

---

## Decision 2: Dedicated Intake Agent (not Planner or Narrator)

**Choice:** Create a separate Intake Agent for player onboarding, distinct from both the Planner and Narrator.

**Rationale:** Each agent should have a single job. The narrator doesn't need a "setup mode" and a "play mode." The planner doesn't need conversational ability. The intake agent can be tuned specifically for warmth and onboarding UX.

**Rejected alternatives:**
- **Planner handles intake directly:** Would work but produces a clinical, form-filling experience. The planner's voice is structured and analytical, not warm and inviting.
- **Narrator handles intake, passes to planner:** Creates an information distillation step where the narrator must accurately extract and structure preferences. Adds complexity and a potential source of information loss.

---

## Decision 3: JSON for Code, Markdown for LLMs

**Choice:** Structured data that code queries lives in JSON. Prose that LLMs read lives in markdown. Some JSON files contain markdown strings inside fields.

**Rationale:** JSON provides deterministic parsing, field-level access, and easy partial updates — essential for the orchestrator and state manager. Markdown reads naturally for LLMs and supports formatting that helps produce stylistically consistent output. The hybrid approach (markdown strings inside JSON) gives clean code access to data structures while providing clean prose for prompt injection.

**Rejected alternative:** Pure markdown for everything, parsed by the LLM. Rejected because it requires string manipulation or regex for updates, is ambiguous for programmatic field access, and is harder to debug.

---

## Decision 4: Victory/Failure Conditions Hidden from Narrator

**Choice:** Victory and failure conditions live in campaign.json (Tier 2), not in encounter briefs (Tier 1). The narrator never sees them.

**Rationale:** The narrator knowing victory/failure conditions creates two problems:
1. Telegraphing — even subtle narrative choices can signal "this is what you're supposed to do"
2. Premature closure — the narrator might steer toward resolution before players have fully engaged

**Initial design:** Victory/failure conditions were in enc_XXX.md. Revised after recognizing these are meta-information about encounter structure, not scene ingredients.

---

## Decision 5: Dynamic Brief Injection (Revelation Mechanism)

**Choice:** The narrator never receives hidden information directly. The planner acts as a gatekeeper that decides what to release and when, then appends approved content to the encounter brief. The narrator only ever reads the brief.

**Rationale:** The narrator's job never changes — it always just reads the brief and narrates. The planner controls what's in the brief at any given moment. This mechanical separation is more reliable than instructing the narrator to withhold information.

**Mechanism:** Revelation conditions in campaign.json are evaluated by the resolver each turn. When triggered, the planner appends a REVEALED section to the encounter brief. The narrator reads the updated brief on the next call.

---

## Decision 6: NPC Cards Split Into Three Files

**Choice:** Each NPC gets three files: narrator card (narrator reads), hidden brief (planner only), and state JSON (code queries).

**Rationale:** NPC cards serve two purposes that are in tension: in-encounter portrayal (narrator needs surface info) and cross-encounter continuity (needs hidden motivations and future arc). Splitting ensures the narrator gets what it needs without being exposed to hidden information.

**Structure:**
- `npc_narrator.md` — appearance, known facts, current relationship with party. Starts sparse, grows as planner appends REVEALED sections.
- `npc_hidden.md` — true identity, future arc, locked revelations. Planner reference only.
- `npc_state.json` — attitude, knowledge tracking, encounter history. Code queries this.

---

## Decision 7: Player Cards

**Choice:** Create player cards parallel to NPC cards, with a narrator-facing markdown file and a state JSON.

**Rationale:** The system was tracking what players know (in encounter and NPC files) but not who players are becoming. Four types of player information exist:
1. In-encounter actions (lifespan: current encounter — handled by active context)
2. Encounter outcomes (lifespan: rest of campaign — handled by encounter summaries)
3. Character expression / behavioral patterns (lifespan: whole campaign — **had no home**)
4. Planner-relevant choices (lifespan: whole campaign — **had no home**)

Types 3 and 4 are the most valuable for making the campaign feel responsive. `behavioral_tags` and `planner_flags` in the state JSON give the planner structured signals to act on — "mercy_shown_count: 2" is something the planner can evaluate programmatically.

---

## Decision 8: Location Cards

**Choice:** Create location cards with narrator-facing markdown and state JSON, including per-object state tracking.

**Rationale:** Without location cards, locations exist only in the context of their featured encounter. This breaks down when:
- Players revisit a location — no reliable reference for what it looks like or what changed
- Object state is untracked — a door left ajar has no structured record
- The planner can't reason about space — object states aren't queryable

Object state tracking enables the planner to use physical environment as a plot engine (e.g., noticing an unexplored room, having an NPC discover evidence of tampering).

---

## Decision 9: Resolver as Pure Evaluator, Not Router

**Choice:** The resolver outputs a structured JSON result. It does not route to the planner or narrator. The orchestrator reads the result and decides execution order.

**Rationale:** If the resolver routes to planner OR narrator as a binary branch, two problems emerge:
- When conditions are met, someone still needs to trigger the narrator after the planner updates
- The narrator never receives player input directly — it reads conversation history

Keeping the resolver as a pure evaluator gives: testability (unit test by feeding inputs and asserting conditions), auditability (resolver_result.json is a turn-by-turn log), and flexibility (new agents slot into the orchestration loop without changing resolver or narrator).

**Corrected flow:** Planner and narrator are sequential, not branching. The planner runs first when there are triggers. The narrator always runs last. Both get called on the same turn when needed.

---

## Decision 10: Orchestrator Is Pure Code, Not an Agent

**Choice:** The orchestrator is a deterministic Node.js script with if/else routing. No LLM calls.

**Rationale:** The orchestrator's decisions are all based on structured data: "Is revelation_triggers[] empty? Is resolution_triggered null?" These are deterministic decisions that don't need language understanding. Making it an agent would introduce non-determinism into the one place that needs absolute reliability, add token costs for work that doesn't need an LLM, and create failure modes where agents get called out of order.

**Principle:** Use agents at the edges where language understanding is required. Use pure code at the center where routing and state management happen.

---

## Decision 11: State Manager as Pure Code Utility

**Choice:** Location, NPC, and player state JSON updates are handled by a pure code State Manager class, not by the planner.

**Rationale:** Steps like "open file, find object by ID, update field, write back" are mechanical file operations with no language understanding needed. The planner handles narrative prose appends to narrator cards (which require judgment). The state manager handles structured JSON updates (which are deterministic).

For object state changes: simple changes (locked → ajar) use pure code templates. Narratively complex changes that need prose judgment trigger a planner call.

---

## Decision 12: Single End-of-Encounter Summarizer

**Choice:** A single summarizer call at encounter close, reading the full encounter exchange and producing one factual summary. Not an incremental per-turn running summary.

**Rationale:** Evaluated three approaches:
1. **Per-turn incremental summarizer (async):** Many calls, overhead per call, outputs for uneventful turns, produces a larger accumulated document as downstream input.
2. **Single end-of-encounter summarizer:** Same total input tokens as incremental, but: smaller output (one concise summary vs. many appends), smaller downstream input to reconciliation pass, lower per-call overhead (1 call vs. dozens).
3. **No summarizer — pass raw exchange to reconciliation:** Most expensive downstream input.

The single end-of-encounter call wins on token cost, output size, and downstream input size. The only tradeoff is latency at the encounter transition point — the summarizer sits in the critical path. Accepted because summary input is bounded by encounter length and this is a natural pause point.

**Fault analysis applied:** Three initially-proposed faults with this approach were examined and found invalid:
- "Incremental reads less total input" — incorrect. Same 50 lines either way.
- "Running summary vs single summary comparison is wrong" — the correct ranking is: full exchange > running summary > single summary. Single summary is smallest.
- "Uneventful turns have value" — contradicts recommending skipping them. If they lack value, the single holistic summary naturally omits them.

---

## Decision 13: Prompt Caching Strategy

**Choice:** Cache the narrator system prompt + world_primer.md, resolver system prompt, and player narrator cards (within an encounter).

**Rationale:** Anthropic supports prompt caching for content that doesn't change between calls. The narrator system prompt and world_primer.md are loaded on every single narrator call and never change during a session — these are the highest-value caching candidates. The resolver system prompt is similarly static. Player narrator cards change only at encounter boundaries, so they can be cached within an encounter.

---

## Decision 14: Reconciliation as Single Bundled Call

**Choice:** The post-encounter reconciliation pass (Call 6) handles all entity updates in one call, outputting a structured JSON bundle that the State Manager fans out to individual files.

**Rationale:** The planner needs to see the encounter holistically to make good arc-level decisions about NPC attitudes, player behavioral tags, and world state. Splitting into separate calls per entity (one for NPCs, one for players, one for locations) would require loading the same base context multiple times, multiplying per-call overhead with no quality benefit.

The planner outputs structured JSON rather than writing files directly, so the State Manager (pure code) handles the fan-out deterministically.

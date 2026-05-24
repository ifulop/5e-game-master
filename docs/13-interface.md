# 13 — HTTP Interface

## Overview

The system exposes a small HTTP API. Player input arrives as POST requests; narration and facilitator responses return as JSON. The server is stateless between requests — all campaign state lives on disk in the `campaign/` directory.

**Decision:** HTTP server (not CLI). The interface maps cleanly to a browser-based chat surface and keeps the server reusable across different front-end implementations.

---

## Tech Stack

- **Runtime:** Node.js, `"type": "module"` (ES modules)
- **HTTP layer:** Node's built-in `http` module or `express` (either works; `express` is recommended for routing clarity)
- **Port:** `3000` (default), configurable via `PORT` environment variable
- **Body parsing:** JSON (`Content-Type: application/json`)
- **No auth** for MVP — single-user local tool

---

## Campaign Phases and Routing

The server routes requests based on the current campaign phase, derived from files on disk:

| Phase | Condition | Accepted Routes |
|---|---|---|
| **No campaign** | `campaign/session.json` absent | `POST /intake` |
| **Intake in progress** | `campaign/intake_conversation.json` present, no `session.json` | `POST /intake` |
| **Setup pending** | `intake.json` written, no `session.json` | `POST /setup` (or auto-triggered) |
| **Scene open** | `session.encounter_status === "awaiting_scene_open"` | `POST /scene` |
| **In turn loop** | `session.encounter_status === "in_progress"` | `POST /turn` |
| **Campaign complete** | `session.encounter_status === "complete"` | `GET /status` only |

`GET /status` is always valid and returns the current phase.

---

## Routes

### `GET /status`

Returns the current campaign phase and enough context for a client to know what to display.

**Response — no campaign:**
```json
{
  "phase": "no_campaign",
  "message": "No campaign in progress. Send POST /intake to begin."
}
```

**Response — intake in progress:**
```json
{
  "phase": "intake",
  "turn": 3
}
```

**Response — game in progress:**
```json
{
  "phase": "in_progress",
  "encounter_id": "enc_002",
  "encounter_index": 1,
  "turn_count": 4,
  "encounter_status": "in_progress"
}
```

**Response — campaign complete:**
```json
{
  "phase": "complete",
  "encounter_id": "enc_005",
  "turn_count": 12
}
```

---

### `POST /intake`

Sends the next player message to the Intake Agent's conversational onboarding. Each request advances the session-zero conversation by one exchange.

**Request body:**
```json
{
  "message": "Her name is Aria, she's a rogue with a complicated past involving the city guard."
}
```

**Response — intake still in progress:**
```json
{
  "done": false,
  "reply": "A rogue with history — perfect. And how does Aria tend to approach problems: through charm and misdirection, or does she prefer to stay in the shadows and observe before acting?"
}
```

**Response — intake complete:**
```json
{
  "done": true,
  "reply": "Excellent. I have everything I need. Give me a moment to prepare your campaign...",
  "next": "POST /setup"
}
```

When `done: true`, the server has written `campaign/intake.json` to disk. The client should immediately call `POST /setup`.

**Intake conversation storage:** Between requests, the conversation history is stored in `campaign/intake_conversation.json` as a temporary file. This file is deleted after `POST /setup` completes successfully.

```json
{
  "messages": [
    { "role": "user", "content": "Her name is Aria..." },
    { "role": "assistant", "content": "A rogue with history — perfect..." }
  ]
}
```

---

### `POST /setup`

Triggers campaign generation from the completed intake. This is a blocking call — it runs the Planner Agent, which writes all campaign files, then opens the first scene via the Narrator Agent.

This call is expensive (one large LLM call to generate the full campaign). Expect 20–60 seconds depending on arc length.

**Request body:** empty `{}` or omit body.

**Response:**
```json
{
  "narration": "The smoke is still rising from the ruins of the Gilded Anchor when you arrive at the docks. The fog is thick tonight — thick enough to hide a sin or two. Somewhere in the maze of pier stalls and salt-stained warehouses, a woman named Vesper knows something about the ledger you pulled from the fire. Where do you begin?"
}
```

On success, `campaign/session.json` is written with `encounter_status: "in_progress"`. Subsequent requests should use `POST /turn`.

**Error — intake not complete:**
```json
{
  "error": "intake_incomplete",
  "message": "intake.json not found. Complete intake before calling /setup."
}
```

---

### `POST /turn`

Sends a player action into the current encounter's turn loop. This is the primary game-loop endpoint — called on every player input after setup.

**Request body:**
```json
{
  "input": "We approach Vesper slowly, hands visible. Aria speaks first: 'We're not here to cause trouble. We just need to know what you saw.'"
}
```

**Response — turn continues:**
```json
{
  "narration": "Vesper's eyes dart to the water, then back to Aria. She doesn't run — but she doesn't relax either. 'Saw plenty I shouldn't have,' she says, voice barely above the lap of the tide. 'What's it worth to you?' She's testing you, measuring how far she can push before you push back. What do you do?"
}
```

**Response — encounter resolved (transition in progress):**
```json
{
  "narration": "Vesper reaches into her coat and presses something cold into Aria's hand — a crumpled invitation, ink smudged at the edges. 'Three nights,' she whispers. 'Don't be late.' Then she's gone, swallowed by the fog before you can ask another question. The next chapter is beginning...",
  "encounter_resolved": true,
  "resolution_type": "victory"
}
```

When `encounter_resolved: true`, the server has already run the full encounter transition (summarizer → planner reconciliation → planner open next) and the session is reset for the new encounter. The narration in the response is `narrator.openScene()` for the new encounter — the client can display it immediately.

**Error — wrong phase:**
```json
{
  "error": "wrong_phase",
  "message": "No active encounter. Current phase: awaiting_scene_open. Call POST /scene."
}
```

---

### `POST /scene`

Opens the current encounter's scene. Only valid when `session.encounter_status === "awaiting_scene_open"`. This state only occurs after a manual reset or if setup completed but the scene was never opened (edge case).

In normal flow this is called automatically by the server at the end of `POST /setup` and at the end of encounter transitions, so the client should rarely need to call it directly.

**Request body:** empty `{}` or omit body.

**Response:**
```json
{
  "narration": "..."
}
```

---

## Error Responses

All error responses use standard HTTP status codes and a consistent body shape:

```json
{
  "error": "error_code",
  "message": "Human-readable description."
}
```

| Status | `error` value | Meaning |
|---|---|---|
| `400` | `wrong_phase` | Request not valid in current campaign phase |
| `400` | `missing_field` | Required request field absent |
| `400` | `intake_incomplete` | `/setup` called before intake finished |
| `409` | `campaign_exists` | `/intake` called when a campaign is already running |
| `500` | `resolver_failed` | Resolver LLM call failed; turn not consumed |
| `500` | `narrator_failed` | Narrator LLM call failed; turn state preserved |
| `500` | `setup_failed` | Campaign generation failed; partial files may exist |
| `503` | `llm_unavailable` | Anthropic API rate limit or service error |

**On `500 resolver_failed`:** The session turn count is NOT incremented. The client may resend the same player input safely.

**On `500 narrator_failed`:** The resolver has already run and session state has been updated. The client should retry without resending the input — use `GET /status` to confirm phase, then retry `POST /turn` with empty body or a special retry signal. (This is rare; document for completeness.)

**On `500 setup_failed`:** The campaign directory may contain partial files. The server does not auto-clean on failure. The operator must manually delete `campaign/` and restart from intake. See docs/06-orchestrator.md for the retry strategy.

---

## Entry Point Structure (`index.js`)

```javascript
import http from 'http';               // or: import express from 'express'
import { setupCampaign, processTurn } from './orchestrator.js';
import { readJSON } from './fileUtils.js';
import { existsSync } from 'fs';

const PORT = process.env.PORT ?? 3000;

// Route: POST /intake
// Route: POST /setup
// Route: POST /turn
// Route: POST /scene
// Route: GET  /status

function getCurrentPhase() {
  if (!existsSync('campaign/session.json')) {
    return existsSync('campaign/intake_conversation.json') ? 'intake' : 'no_campaign';
  }
  const session = readJSON('campaign/session.json');
  if (session.encounter_status === 'complete') return 'complete';
  if (session.encounter_status === 'awaiting_scene_open') return 'awaiting_scene_open';
  return 'in_progress';
}
```

---

## Streaming (Optional Enhancement)

Narration responses can be 200–600 words. At typical LLM generation speeds this takes 5–20 seconds for a blocking response. For better UX, the Anthropic SDK supports streaming via `stream: true`.

**Streaming is not required for MVP** — blocking responses are simpler to implement and test. If streaming is added later:
- Use `Transfer-Encoding: chunked` with `Content-Type: text/event-stream` (Server-Sent Events)
- Stream only narration routes (`/setup`, `/turn`, `/scene`) — `/status` and `/intake` are fast and need no streaming
- The client accumulates chunks and displays them as they arrive, typewriter-style

This is listed in `docs/10-post-mvp-enhancements.md` territory but implementable in a single afternoon once the blocking version is stable.

---

## WBS Checklist Additions

These tasks should be added to `11-wbs.md` Phase 0 and Phase 8 to cover the HTTP layer:

**Phase 0.1 additions:**
- [ ] Add `express` to `package.json` dependencies (or note use of built-in `http`)
- [ ] Create `server.js` as the HTTP entry point (separate from `orchestrator.js`)

**Phase 8.3 additions (replaces the vague "expose a simple CLI or HTTP interface"):**
- [ ] Implement `GET /status` — derive phase from file system state
- [ ] Implement `POST /intake` — route player message to intake agent; persist conversation to `campaign/intake_conversation.json`
- [ ] Implement `POST /setup` — call `setupCampaign()`; return opening narration
- [ ] Implement `POST /turn` — call `processTurn(input)`; return narration; include `encounter_resolved` flag when transition occurs
- [ ] Implement `POST /scene` — call `narrator.openScene()`; guard against wrong-phase calls
- [ ] Implement error middleware — consistent `{ error, message }` shape for all 4xx/5xx responses
- [ ] Smoke test all routes in sequence: intake → setup → 3 turns → (trigger resolution) → turn in new encounter

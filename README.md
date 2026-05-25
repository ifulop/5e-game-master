# 5e RPG Dungeon Master Agent

A generative Dungeon Master engine for running Fifth Edition Rules-compatible RPG campaigns. The system generates and manages a hidden story arc, reveals content encounter-by-encounter, and responds dynamically to player choices — while keeping secret plot information strictly separated from what the players see.

The central design rule: **the system that knows the secrets is not the system that talks to the players.** A hidden planning layer controls the story arc and all reveal timing. A separate narration layer only ever sees information that has already been explicitly released to it.

---

## Getting Started

### Prerequisites

- Node.js 18+
- An Anthropic API key

### Setup

```bash
npm install
```

Create a `.env` file in the project root:

```
ANTHROPIC_API_KEY=your_key_here
```

### Run

```bash
node server.js
```

Open `http://localhost:3000` in your browser.

---

## How It Works

### Campaign setup

1. Click **New Campaign** and fill out the character creation form — name, class, personality, backstory, and playstyle for each party member, plus campaign preferences (tone, goal, session length, combat style, content limits).
2. Submit the form. The system summarises your characters and invites you to add any extra details before generation begins.
3. Click **Generate Campaign** (or **Add Details** first). The Planner generates the full campaign arc, including all encounter briefs, NPC cards, location files, and hidden plot threads.
4. The Narrator opens the first scene.

### Gameplay

Type what your party does and press **Act** (or Enter). Each turn:

- The **Resolver** evaluates the input against hidden resolution and revelation conditions
- Object and NPC state changes are applied by the **State Manager**
- If a revelation is triggered, the **Planner** appends newly unlocked content to the relevant narrator-facing files
- The **Narrator** responds using only the information it is permitted to see

When an encounter resolves, a **Summarizer** writes a factual summary, the **Planner** reconciles world state changes, and the Narrator opens the next scene.

### Saving and resuming

- **Save** — saves the current state and stays in the game
- **Save & Quit** — saves and returns to the home screen
- **Save & Continue** (at encounter boundaries) — saves before opening the next scene
- The home screen shows all saved campaigns; click any to resume

On resume, the Narrator receives a brief that reconstructs the story context — where you left off, prior encounter summaries, and recent turns.

### End of campaign

After the final encounter resolves, click **Receive Epilogue** for a closing narration. The adventure summary and full transcript are available to download from the completion screen.

---

## Architecture

### Two cognitive layers

| Layer | Components | What it sees |
|---|---|---|
| Planning | Planner, Resolver | Full campaign arc, all hidden conditions, NPC motivations, future encounters |
| Narration | Narrator, Summarizer | Only released encounter briefs, narrator cards, prior summaries |

The Narrator never receives `arc_brief.md`, any `npc_hidden.md`, resolution conditions, revelation conditions, or future encounter content.

### Agents

| Agent | Type | Role |
|---|---|---|
| Intake | LLM | Receives form data, summarises characters, optionally enriches with additional player details |
| Planner | LLM | Generates campaign arc, appends revelations, reconciles state after encounters, adjusts next encounters |
| Resolver | LLM | Evaluates each player turn into a structured JSON result: resolution triggers, revelation triggers, NPC attitude changes, object state changes |
| Narrator | LLM | Player-facing scene narration; never sees hidden information |
| Summarizer | LLM | Writes a factual end-of-encounter summary used in subsequent context |
| Orchestrator | Code | Controls execution order and turn loop |
| State Manager | Code | Applies structured updates to JSON state files |

### Campaign state on disk

Each campaign lives in its own directory under `campaigns/`:

```
campaigns/
├── active_id                  ← UUID of the currently active campaign
├── index.json                 ← registry of all campaigns
└── {campaign_uuid}/
    ├── campaign.json          ← full arc: encounters, conditions, world state
    ├── session.json           ← runtime session state
    ├── intake.json            ← party + preferences
    ├── arc_brief.md           ← planner-only: hidden arc summary
    ├── world_primer.md        ← narrator-visible world context
    ├── adventure_transcript.md
    ├── save_brief.md          ← generated on save; consumed once on resume
    ├── encounters/            ← encounter briefs + summaries
    ├── locations/             ← location state + narrator cards
    ├── npcs/                  ← NPC state + narrator cards + hidden files
    └── players/               ← player state + narrator cards
```

The `campaigns/` directory is gitignored. Multiple campaigns can coexist on disk simultaneously.

### Project structure

```
.
├── server.js           ← Express HTTP server + route handlers
├── index.js            ← Orchestrator: setupCampaign, processTurn, handleEncounterTransition
├── stateManager.js     ← Applies structured state updates to disk
├── fileUtils.js        ← readJSON, writeJSON, writeFile, appendToFile
├── agents/
│   ├── intake.js
│   ├── planner.js
│   ├── resolver.js
│   ├── narrator.js
│   └── summarizer.js
├── prompts/
│   ├── intake_review_system.txt
│   ├── intake_finalize_system.txt
│   ├── planner_system.txt
│   ├── planner_revelation.txt
│   ├── planner_reconciliation.txt
│   ├── planner_open_encounter.txt
│   ├── resolver_system.txt
│   ├── narrator_system.txt
│   └── summarizer_system.txt
├── public/
│   └── index.html      ← Browser UI (vanilla JS, no build step)
└── docs/               ← Architecture, schemas, agent specs, design decisions
```

---

## HTTP API

| Method | Path | Description |
|---|---|---|
| `GET` | `/status` | Current campaign phase and session info |
| `GET` | `/campaigns` | List of all saved campaigns |
| `POST` | `/intake` | Step 1: `{ party, preferences }` → character review; Step 2: `{ additional }` or `{ skip: true }` → write `intake.json` |
| `POST` | `/setup` | Generate campaign from `intake.json`, open first scene |
| `POST` | `/turn` | `{ input }` → resolve player action, return narration |
| `POST` | `/scene` | Open next scene (or deliver epilogue if campaign complete) |
| `POST` | `/save` | `{ name?, quit? }` → save campaign state |
| `POST` | `/reset` | Abandon current campaign, return to home |
| `POST` | `/campaigns/:id/load` | Switch active campaign |
| `GET` | `/adventure/summary` | Download encounter summaries as markdown |
| `GET` | `/adventure/transcript` | Download full narration transcript |

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required |
| `PORT` | `3000` | HTTP server port |
| `NARRATOR_MODEL` | `claude-sonnet-4-6` | Model for the Narrator agent |
| `INTAKE_MODEL` | `claude-sonnet-4-6` | Model for the Intake agent |

Other agents use the default Anthropic SDK model unless you add equivalent env overrides in their respective files.

---

## Design Principles

1. **Two cognitive layers** — the Planning layer holds all secrets; the Narration layer only sees released information. This is a hard architectural boundary, not a prompt instruction.

2. **Need-to-know file access** — each agent reads only the files required for its specific job. The narrator never loads the whole campaign.

3. **Pure-code orchestration** — routing, sequencing, and state mutation are deterministic code. Agents handle language tasks; code handles control flow.

4. **JSON for code, markdown for LLMs** — structured state that code queries lives in JSON. Prose that LLMs read lives in markdown.

5. **Tiered context loading** — no agent ever loads the full campaign. Each call receives the smallest relevant context slice for that specific operation.

---

## Documentation

The `docs/` directory contains the full architecture and design specification:

| Document | Contents |
|---|---|
| `docs/01-architecture.md` | Component boundaries, cognitive layers, context tiers |
| `docs/02-file-structure.md` | File layout and access matrix |
| `docs/03-data-schemas.md` | JSON schemas for all structured files |
| `docs/04-markdown-templates.md` | Templates for all markdown files |
| `docs/05-agents.md` | Agent roles, system prompt guidance, I/O contracts |
| `docs/06-orchestrator.md` | Deterministic control flow and turn loop |
| `docs/07-llm-call-inventory.md` | Every LLM call with inputs, outputs, and cost profile |
| `docs/08-information-flow.md` | End-to-end flow diagrams |
| `docs/09-design-decisions.md` | Rationale and rejected alternatives |

---

## License
This project is dual-licensed: free to use under the
[AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html) for open source use, and available
under a commercial license for proprietary or closed-source projects — contact
Istvan Fulop at ifulop@gmail.com for commercial licensing inquiries.

This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

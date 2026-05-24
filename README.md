# 5e Game Master Agent

A generative Game Master system for running 5e-compatible RPG campaigns with a strict separation between hidden story logic and player-facing narration.

The project is designed around a simple rule: the system that knows the secrets is not the system that talks to the players. A hidden planning layer manages the story arc, encounter outcomes, revelations, and world state. A separate narration layer only sees information that has already been explicitly released.

## Project Status

This repository is currently a **design-first spec repo**. The architecture, data model, file layout, agent contracts, orchestration flow, build plan, and testing strategy are documented. Implementation is planned but not yet committed in this repository.

Current state:
- Core product and architecture spec complete
- Data schemas complete
- Agent responsibilities and prompt contracts complete
- Orchestrator and information-flow design complete
- Work Breakdown Structure complete
- Testing strategy complete
- Runtime code not yet scaffolded

## What This Project Is

This project implements a campaign engine that can:
- onboard a party through a conversational intake flow
- generate a full hidden campaign arc from those preferences
- run encounter-by-encounter narration in a player-facing voice
- evaluate player intent against hidden resolution and revelation conditions
- update world state, NPC attitudes, player knowledge, and encounter materials over time
- carry campaign consequences forward across encounters

The target experience is a responsive DM that feels improvisational to players while still preserving hidden structure behind the scenes.

## Core Design Principles

1. **Two cognitive layers**
   A hidden Planning Layer controls the campaign arc and reveal timing. A separate Narration Layer talks to players and never sees hidden material.

2. **Need-to-know file access**
   Every component only reads the files required for its job. This is a correctness rule, not just an optimization.

3. **Pure-code orchestration**
   Routing, sequencing, and state mutation are deterministic code. Agents handle language tasks. Code handles control flow.

4. **JSON for code, markdown for LLMs**
   Structured state lives in JSON. Narrative guidance and prose live in markdown.

5. **Tiered context loading**
   The narrator never loads the whole campaign. Each call gets only the smallest relevant context slice.

## Why The Separation Matters

Traditional single-agent DM designs tend to fail in one of two ways:
- the model leaks hidden information because it already knows the full plot
- the model starts steering players toward predefined outcomes because it can see the win conditions

This design avoids that by splitting responsibilities:
- the **Planner** knows the arc, hidden motivations, unrevealed plot threads, and future encounters
- the **Narrator** only knows what is currently visible in encounter briefs, narrator cards, and prior summaries
- the **Resolver** evaluates player actions into structured results but does not narrate or route
- the **Orchestrator** decides what runs next using deterministic code

## System Overview

### Main Components

| Component | Type | Role |
|---|---|---|
| Intake Agent | LLM | Conversational onboarding and preference gathering |
| Planner Agent | LLM | Campaign generation, revelations, reconciliation, encounter adjustment |
| Resolver Agent | LLM | Turn-by-turn condition evaluation into structured JSON |
| Narrator Agent | LLM | Player-facing scene narration and NPC portrayal |
| Summarizer Agent | LLM | End-of-encounter factual summary |
| Orchestrator | Pure code | Controls execution order and turn loop |
| State Manager | Pure code | Applies JSON state updates and file mutations |

### Runtime Flow

#### 1. Campaign setup
- Intake Agent gathers party details and preferences into `intake.json`
- Planner Agent generates the campaign file tree
- Orchestrator creates `session.json` and player files
- Narrator opens the first scene

#### 2. Per-turn loop
- Orchestrator records the player input
- Resolver evaluates the turn and writes `resolver_result.json`
- State Manager applies mechanical object changes
- Planner appends newly revealed information when triggered
- Planner updates narrator-facing prose when object changes need narrative treatment
- State Manager applies NPC attitude shifts before narration
- Narrator responds using the updated encounter materials

#### 3. Encounter transition
- Summarizer writes an encounter summary
- Planner performs reconciliation and produces a structured update bundle
- State Manager fans those updates out across campaign, NPC, player, and location files
- Planner adjusts or confirms the next encounter
- Orchestrator resets session state
- Narrator opens the new scene

## Information Architecture

### Three-tier content model

| Tier | Who can read it | Examples |
|---|---|---|
| Tier 1 | Narrator + Planner | `enc_XXX.md`, `world_primer.md`, narrator cards |
| Tier 2 | Resolver + Planner + code | `campaign.json` conditions, `session.json`, state JSON files |
| Tier 3 | Planner only | `arc_brief.md`, `npc_hidden.md`, future encounter implications |

### Critical security property

The narrator must never receive:
- `arc_brief.md`
- any `npc_hidden.md`
- `campaign.json` resolution conditions
- `campaign.json` revelation conditions
- hidden location secrets
- future encounter briefs

This repository's testing strategy includes dedicated structural and canary-based tests to enforce that boundary.

## Planned Project Structure

Once implementation begins, the runtime project is expected to follow this layout:

```text
.
├── index.js
├── stateManager.js
├── fileUtils.js
├── agents/
│   ├── intake.js
│   ├── planner.js
│   ├── resolver.js
│   ├── narrator.js
│   └── summarizer.js
├── prompts/
│   ├── intake_system.txt
│   ├── planner_system.txt
│   ├── planner_revelation.txt
│   ├── planner_reconciliation.txt
│   ├── planner_open_encounter.txt
│   ├── resolver_system.txt
│   ├── narrator_system.txt
│   └── summarizer_system.txt
├── campaign/
│   ├── campaign.json
│   ├── intake.json
│   ├── session.json
│   ├── resolver_result.json
│   ├── arc_brief.md
│   ├── world_primer.md
│   ├── encounters/
│   ├── locations/
│   ├── npcs/
│   └── players/
└── tests/
```

## Documentation Map

If you are reading this repo for the first time, use this order:

1. [CLAUDE.md](CLAUDE.md) — project entrypoint and design summary
2. [docs/00-pre-build-checklist.md](docs/00-pre-build-checklist.md) — current documentation coverage and remaining gaps
3. [docs/01-architecture.md](docs/01-architecture.md) — component boundaries and context tiers
4. [docs/02-file-structure.md](docs/02-file-structure.md) — file layout and access matrix
5. [docs/03-data-schemas.md](docs/03-data-schemas.md) — JSON contracts
6. [docs/04-markdown-templates.md](docs/04-markdown-templates.md) — markdown file templates
7. [docs/05-agents.md](docs/05-agents.md) — agent roles, system prompts, constraints, and I/O contracts
8. [docs/06-orchestrator.md](docs/06-orchestrator.md) — deterministic control flow and state updates
9. [docs/07-llm-call-inventory.md](docs/07-llm-call-inventory.md) — every LLM call, its inputs, outputs, and cost profile
10. [docs/08-information-flow.md](docs/08-information-flow.md) — end-to-end flow diagrams
11. [docs/09-design-decisions.md](docs/09-design-decisions.md) — rationale and rejected alternatives
12. [docs/10-post-mvp-enhancements.md](docs/10-post-mvp-enhancements.md) — deferred features list
13. [docs/11-wbs.md](docs/11-wbs.md) — phased build plan
14. [docs/12-testing-strategy.md](docs/12-testing-strategy.md) — per-phase verification and test suites

## Build Plan Summary

Implementation is intentionally staged so the turn loop is runnable early, before all real model calls exist.

| Phase | Goal |
|---|---|
| 0 | Scaffold project, dependencies, and file utilities |
| 1 | Build orchestrator skeleton with agent stubs |
| 2 | Implement and test state manager |
| 3 | Implement resolver as the first real agent |
| 4 | Implement planner and all planner call modes |
| 5 | Implement narrator with strict context loading |
| 6 | Implement summarizer |
| 7 | Implement intake |
| 8 | Replace stubs, integrate, and add failure handling |
| 9 | Run full end-to-end validation |

The key strategy is to stub agents first so routing and state mutation can be validated before real LLM behavior is introduced.

## Testing Strategy Summary

The test plan mirrors the build plan and focuses on the highest-risk failure modes.

### 1. Pure-code correctness
- unit tests for file utilities and state manager
- routing tests for orchestrator step order and branching
- explicit verification that attitude changes are applied before narrator execution

### 2. LLM contract validation
- schema checks for resolver and planner structured outputs
- context assembly checks for narrator inputs
- summary quality and boundedness checks for summarizer

### 3. Information separation
- static file-access tests to ensure forbidden files are never loaded into narrator context
- canary-string tests that detect hidden file leakage in narrator output
- explicit leak checks ensuring encounter briefs do not contain resolution or revelation metadata

### 4. End-to-end behavior
- full multi-turn campaign runs with real model calls
- transition tests across encounter boundaries
- prompt injection baseline tests against player input

## MVP Scope

The current MVP is designed as:
- a Node.js orchestrator
- Anthropic Claude API integration or a compatible LLM provider
- file-system-based campaign state using JSON and markdown on disk
- single-session execution without persistent resume support

The MVP is not currently designed as:
- a public API product
- a multi-tenant hosted platform
- a full battle-engine simulation
- a voice-first experience
- a persistent campaign management platform

## Post-MVP Enhancements

Deferred features already identified for later phases:
- session persistence
- voice recognition for player input
- voice narration output
- structured battle engine
- image generation for scene support
- adaptive soundscape generation

See [docs/10-post-mvp-enhancements.md](docs/10-post-mvp-enhancements.md) for details and rationale.

## Expected Tech Stack

Planned implementation stack:
- Node.js for orchestration
- Anthropic Claude API for LLM calls
- Local file system for state storage in MVP
- Jest for test automation
- dotenv for local configuration

## Repository Use

This repository is best understood as the authoritative product and engineering spec for the project. It is intended to support:
- implementation planning
- architecture review
- agent prompt design
- correctness review for information boundaries
- phased development and testing

If you are starting implementation, begin with [docs/11-wbs.md](docs/11-wbs.md) and keep [docs/12-testing-strategy.md](docs/12-testing-strategy.md) open alongside it.

## Open Gaps Still Tracked

The pre-build checklist still identifies several documents that may be worth adding before or during implementation, including:
- PRD / explicit acceptance criteria
- non-functional requirements
- infrastructure diagram
- authentication / authorization design
- wireframes or UI mockups
- roadmap / milestone plan
- threat model

See [docs/00-pre-build-checklist.md](docs/00-pre-build-checklist.md) for the current status.

## License

This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/ legalcode.

## Contributing

There is no formal contribution workflow in the repository yet. If development starts in this repo, the next practical setup steps are:
1. scaffold the Node.js project from the WBS
2. add the test harness from the testing strategy
3. implement the orchestrator skeleton and stubs first

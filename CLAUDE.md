# 5e RPG Dungeon Master Agent — Project Specification

## Purpose

This project implements an AI-powered Dungeon Master agent for 5e RPG campaigns. The system generates and manages a hidden story arc, reveals content encounter-by-encounter, and responds dynamically to player choices — all while keeping secret plot information strictly separated from what players see.

## Documentation Index

Read these documents in order. Each one is self-contained but builds on the previous.

| Document | Contents |
|---|---|
| `CLAUDE.md` | This file. Project overview and entry point. |
| `docs/00-pre-build-checklist.md` | Design and planning guide. |
| `docs/01-architecture.md` | Core architecture, design principles, cognitive layers, tiered context model. |
| `docs/02-file-structure.md` | Complete file/folder layout with every file's purpose, format, and access rules. |
| `docs/03-data-schemas.md` | Full JSON schemas for every structured data file: campaign.json, session.json, all state.json files, resolver_result.json, intake.json. |
| `docs/04-markdown-templates.md` | Templates for every markdown file: arc_brief.md, world_primer.md, encounter briefs, NPC cards, player cards, location cards. |
| `docs/05-agents.md` | Specification for each LLM-powered agent: Intake, Planner, Resolver, Narrator, Summarizer. Includes system prompt guidance, input/output contracts, and behavioral constraints. |
| `docs/06-orchestrator.md` | Pure-code orchestrator logic: routing rules, execution order, the turn loop, encounter transitions, state manager utility. |
| `docs/07-llm-call-inventory.md` | Complete inventory of every LLM call in execution order, with exact prompt inputs, outputs, and cost considerations. |
| `docs/08-information-flow.md` | Information flow diagrams for setup phase, per-turn loop, encounter transitions, and the revelation mechanism. |
| `docs/09-design-decisions.md` | Log of all architectural decisions made during design, with rationale and rejected alternatives. |
| `docs/10-post-mvp-enhancements.md` | List of future upgrades to consider after MVP build. |
| `docs/11-wbs.md` | Work Breakdown Structure: phase-by-phase build order, tasks, stub pattern, dependency graph, and per-phase verification criteria. |
| `docs/12-testing-strategy.md` | Comprehensive testing strategy: test levels, fixtures, per-phase suites, information separation tests, prompt injection tests, and run modes. |

## Key Design Principles

1. **Two cognitive layers**: A hidden Planning Layer and a player-facing Narration Layer that never share context.
2. **Need-to-know information access**: Each agent reads only the files it needs. The narrator never sees hidden information. The planner controls what gets revealed and when.
3. **Pure code orchestration**: The orchestrator is deterministic code, not an agent. Agents handle language understanding; code handles routing and state.
4. **JSON for code, markdown for LLMs**: Structured data that code queries lives in JSON. Prose that LLMs read lives in markdown. Some files contain markdown strings inside JSON.
5. **Tiered context loading**: Never load everything at once. Each prompt gets only what it needs for its specific job.

## Tech Stack Assumptions

- Node.js orchestrator
- Anthropic Claude API (or compatible LLM API)
- File-system-based state (JSON + markdown files on disk)
- No database required for MVP — MongoDB or similar can be added later for multi-session persistence

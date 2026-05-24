# Pre-build documentation checklist

5e RPG Agent — assessed against existing project docs.

**Status values:** `Covered` — exists in project docs | `Partial` — partially addressed | `Needed` — gap, create before build | `N/A` — not applicable for this project

---

## 1. Requirements

| Document | Status | Notes |
|---|---|---|
| Business Requirements Document (BRD) | Needed | Business goals, success metrics, and stakeholders not addressed. Project docs are purely technical. |
| Product Requirements Document (PRD) | Partial | Player-facing features and user stories exist implicitly in agent specs and orchestrator docs, but no explicit acceptance criteria or feature list. See `05-agents.md`, `06-orchestrator.md`. |
| Functional Requirements | Covered | Agent input/output contracts, behavioral constraints, orchestrator routing rules, and resolver evaluation logic are all specified. See `05-agents.md`, `06-orchestrator.md`, `07-llm-call-inventory.md`. |
| Non-Functional Requirements | Needed | No explicit targets for latency, uptime, token cost limits, concurrent session support, or error rate thresholds. Token cost principles are noted but not formalised. |

---

## 2. Architecture & Design

| Document | Status | Notes |
|---|---|---|
| Technical Architecture Diagram | Partial | Two-layer cognitive architecture and component overview exist in prose and ASCII but no formal diagram file. See `01-architecture.md`. |
| System Context Diagram | Covered | Information flow diagrams cover setup, per-turn loop, and encounter transition phases in detail. See `08-information-flow.md`. |
| Component / Service Diagram | Covered | All components (agents, orchestrator, state manager) defined with roles, player-facing status, and interaction boundaries. See `01-architecture.md`, `02-file-structure.md`. |
| Infrastructure Diagram | Needed | No deployment environment specified. File-system state is noted as MVP approach but hosting, CI/CD, and API key management are undocumented. |

---

## 3. Data Design

| Document | Status | Notes |
|---|---|---|
| Entity Relationship Diagram (ERD) | Partial | All data entities defined with schemas but relationships between them are not formally diagrammed. See `03-data-schemas.md`. |
| Database Schema | Covered | Full JSON schemas for every structured file: `campaign.json`, `session.json`, `resolver_result.json`, `npc_state.json`, `player_state.json`, `location_state.json`, `intake.json`. See `03-data-schemas.md`. |
| Data Flow Diagram (DFD) | Covered | Information flow diagrams document how data moves between all components across all three phases. See `08-information-flow.md`. |
| Data Dictionary | Partial | Field-level definitions exist within schema examples but not compiled into a standalone dictionary. Key fields like `behavioral_tags` and `planner_flags` have inline rationale but no formal reference. See `03-data-schemas.md`, `09-design-decisions.md`. |

---

## 4. Process & Workflow

| Document | Status | Notes |
|---|---|---|
| Process Flow Diagrams | Covered | Setup phase, per-turn loop, and encounter transition are fully diagrammed with flow and narrative explanation. See `08-information-flow.md`, `06-orchestrator.md`. |
| User Flow Diagrams | Covered | End-to-end player journey completed (v2) — includes loading states, error handling at four points, epilogue, campaign summary download, and return to landing page. |
| Sequence Diagrams | Covered | LLM call inventory documents every call in execution order with exact inputs, outputs, and timing. See `07-llm-call-inventory.md`. |
| State Diagrams | Covered | All three state machines diagrammed: encounter status (5 states), NPC attitude (5 states, any-to-any resolver transitions), and campaign progress (6 states including abandoned). |

---

## 5. API & Integration Design

| Document | Status | Notes |
|---|---|---|
| API Specification (OpenAPI / Swagger) | N/A | Not an API-first product. No public-facing API surface — self-contained Node.js application. |
| Integration Map | Partial | Anthropic Claude API is the only external dependency. No documentation of API key management, rate limit handling, or fallback behaviour on API failure. See `06-orchestrator.md` (error handling section). |
| Authentication / Authorization Design | Needed | No auth model documented. Multi-player session isolation, API key storage, and player identity are all unaddressed. |

---

## 6. UI / UX Design

| Document | Status | Notes |
|---|---|---|
| Wireframes | Needed | No UI designed. Player interface (chat surface, intake flow, narration display, loading states) unspecified. |
| Mockups / Prototypes | Needed | No visual design exists. Depends on whether a dedicated web UI is built beyond a basic chat surface. |
| Design System | N/A | Not applicable for MVP. Revisit if a full web UI is built. |

---

## 7. Project Planning

| Document | Status | Notes |
|---|---|---|
| Scope Document | Partial | MVP vs future state noted (no DB for MVP; MongoDB later). Explicit in-scope / out-of-scope list and feature cutoffs not defined. See `CLAUDE.md`. |
| Work Breakdown Structure (WBS) | Covered | Phase-by-phase build order with tasks, stubs pattern, dependency graph, and per-phase verification criteria. See `11-wbs.md`. |
| Roadmap / Milestone Plan | Needed | No phasing, timeline, or release plan. Build sequence matters for testability — agents should be stubbed in a deliberate order. |
| Risk Register | Partial | Some risks implicitly addressed (LLM info leakage, narrator context contamination, summarizer latency). No formal register with likelihood / impact / mitigation. See `09-design-decisions.md`. |

---

## 8. Security & Compliance

| Document | Status | Notes |
|---|---|---|
| Threat Model | Needed | No threat model. Key surfaces: API key exposure in file system, prompt injection via player input into resolver / narrator, info leakage from narrator context. |
| Compliance Checklist | N/A | No PII collection, no payments, no health data. GDPR / HIPAA / SOC2 not applicable for MVP unless multi-tenant hosting is planned. |

---

## Summary

| Status | Count |
|---|---|
| Covered | 11 |
| Partial | 6 |
| Needed | 7 |
| N/A | 5 |



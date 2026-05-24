# 04 — Markdown Templates

## Template Principles

All markdown files serve one of two purposes:
1. **Planner reference** — rich, complete, hidden from narrator
2. **Narrator reference** — surface-level, evocative, safe to inject into player-facing prompts

Every markdown file has a clear owner (who writes it) and a clear consumer (who reads it). Templates below show the initial structure and how each file evolves during play.

---

## arc_brief.md — The DM's Secret Bible

**Written by**: Planner (at campaign start)
**Read by**: Planner only (for reconciliation and replanning)
**Never read by**: Narrator, Resolver, Orchestrator
**Updated**: Only if replanning is triggered by players going far off-script

```markdown
# [Campaign Title] — Arc Brief

## The Truth (Hidden)
[Full description of the hidden conspiracy, conflict, or mystery that drives
the campaign. This is the complete picture that players are meant to uncover
piece by piece over the course of the campaign.]

## The Revelation Sequence
- Enc 1: [What players learn / what clue is planted]
- Enc 2: [How the next piece connects]
- Enc 3: [The escalation point]
- Enc 4: [The penultimate discovery]
- Enc 5: [The confrontation and final revelation]

## Threads That Must Pay Off
- [Player backstory element] connects to [arc element]
- [Item found in enc_X] reappears as [plot device] in enc_Y
- [NPC introduced in enc_X] reveals their true role in enc_Y

## Themes
- [Theme 1]: how it manifests across encounters
- [Theme 2]: how it manifests across encounters
```

---

## world_primer.md — Narrator's Ambient Reference

**Written by**: Planner (at campaign start)
**Read by**: Narrator (loaded into system prompt every turn)
**Target length**: Under 400 words to minimize token cost (loaded on every narrator call)

```markdown
# World Primer

## The Setting
[2-3 sentences establishing the world — geography, era, atmosphere.
Concrete sensory anchors, not abstract worldbuilding.]

## Tone Notes
[Instructions for the narrator's voice. What kind of descriptions to favor.
Sensory details to emphasize. Pacing guidance.]

## What the Players Know
[The party's shared understanding of their situation at campaign start.
Their role in the world, their relationships, their baseline knowledge.
Updated by planner post-encounter if major revelations change the baseline.]
```

---

## encounters/enc_XXX.md — Encounter Brief

**Written by**: Planner (at campaign start)
**Read by**: Narrator (loaded when this encounter is active)
**Updated during play**: Planner appends REVEALED sections when conditions are met
**Critical constraint**: Contains NO hidden information. No victory/failure conditions. No plot secrets. Only what the narrator needs to set and run the scene.

### Initial Structure (at campaign start)

```markdown
# Enc [NNN] — [Title]

## Scene Setting
[Rich atmospheric description. Sensory details — sights, sounds, smells.
Enough for the narrator to establish the location convincingly.]

## What the Players Know Coming In
[What information the party carries from previous encounters that is
relevant to this scene. Transition context.]

## Atmosphere
[Emotional tone of the scene. Tense? Festive? Eerie? How NPCs behave.
What the general mood should feel like.]

## What Can Happen Here
- [Possibility 1 — describes ingredients without outcomes]
- [Possibility 2 — what NPCs might do, what objects are present]
- [Possibility 3 — environmental factors, complications]

[NOTE: This section describes POSSIBILITIES without OUTCOMES.
It tells the narrator the ingredients of the scene without
telling it what winning or losing looks like.]
```

### During Play (planner appends)

```markdown
---
## REVEALED — [Turn N]
[Content the planner has approved for release. This might be
a character's willingness to share new information, an environmental
change, a plot development the narrator should now incorporate.]

## REVEALED — [Turn M]
[Additional released content. Each REVEALED section is timestamped
with the turn number for debugging and audit purposes.]
```

---

## encounters/enc_XXX_summary.md — Post-Encounter Summary

**Written by**: Summarizer Agent (single call at encounter close)
**Read by**: Narrator (transition context for next encounter), Planner (reconciliation)
**Tone**: Strictly factual, past tense, no atmosphere. A record, not narration.

```markdown
# Enc [NNN] Summary — [Title]

## Outcome: [success / failure / partial]

## What Happened
[Concise factual summary of the encounter — what the players did,
what they learned, what changed. 3-5 sentences maximum.]

## Key Actions Taken
[Specific player actions that had consequences — not every turn,
only the meaningful ones.]

## State Changes
- [NPC attitude change]
- [Object state change]
- [Knowledge gained]
- [Items acquired/lost]
```

---

## npcs/[name]/[name]_narrator.md — NPC Narrator Card

**Written by**: Planner (at campaign start, updated during and after encounters)
**Read by**: Narrator (loaded on demand when NPC is active in current encounter)
**Updated**: Mid-encounter REVEALED sections + post-encounter reconciliation updates

### Initial Structure

```markdown
# [NPC Name] — Narrator Card

## Appearance & Manner
[Physical description, mannerisms, speech patterns, sensory details.
Enough for the narrator to portray this NPC convincingly in dialogue
and action.]

## What the Party Currently Knows
[Only facts the players have actually learned about this NPC.
Starts minimal. Grows as the campaign progresses.]

## How They Treat the Party
[Current attitude and behavioral disposition toward the party.
Updated after each encounter where this NPC appears.]
```

### During Play (planner appends)

```markdown
---
## REVEALED — Enc [NNN], Turn [N]
[New behavioral guidance for the narrator — e.g., "Vesper has warmed
slightly. She will now respond to direct questions about the docks
without deflecting."]

## REVEALED — Enc [NNN] Close
[Post-encounter status update — e.g., "Vesper pressed a gala invitation
into Aria's hand before disappearing. The party does not know if she
will surface again."]
```

---

## npcs/[name]/[name]_hidden.md — NPC Hidden Brief

**Written by**: Planner (at campaign start)
**Read by**: Planner only (for revelation decisions and reconciliation)
**Never read by**: Narrator, Resolver
**Updated**: By planner if NPC's future arc needs adjustment based on player choices

```markdown
# [NPC Name] — Hidden Brief

## True Identity
[Who this NPC actually is. Their real role in the plot.
Everything the players don't know yet.]

## Their Arc
[How this NPC is intended to develop across the campaign.
What role they play in the overall story. Contingencies
for different player approaches.]

## What They Could Eventually Reveal
- [Secret 1 — and the condition under which it surfaces]
- [Secret 2 — and its condition]
- [Secret 3 — and its condition]

## Revelation Gates
- [Trigger description] → only if [player condition]
- [Trigger description] → only after [encounter/event]
- [Trigger description] → at planner discretion, [timing guidance]
```

---

## players/[name]/[name]_narrator.md — Player Narrator Card

**Written by**: Orchestrator (initial profile from intake.json), Planner (ongoing updates)
**Read by**: Narrator (loaded every turn for all party members)

```markdown
# [Player Name] — Player Card

## Character Profile
[Class, personality, backstory hook. Core traits that define
how the world should respond to this character.]

## Established Behaviors
Patterns the narrator should reflect in how the world responds:
- [Behavioral pattern 1 — e.g., "Consistently uses deception over confrontation"]
- [Behavioral pattern 2 — e.g., "Has twice shown unexpected mercy to frightened NPCs"]
- [Behavioral pattern 3 — e.g., "Visibly uncomfortable when city officials are present"]

## Relationships
- [NPC name]: [current relationship status and tone]
- [NPC name]: [current relationship status and tone]

## What [Name] Currently Knows
- [Knowledge item 1]
- [Knowledge item 2]
- [Knowledge item 3]

---
## Post Enc [NNN] Update
[Planner-written update capturing significant new behaviors,
relationship changes, or knowledge gained in the most recent encounter.]
```

---

## locations/[name]/[name]_narrator.md — Location Narrator Card

**Written by**: Planner (at campaign start, updated during and after encounters)
**Read by**: Narrator (loaded when this location is active)

```markdown
# [Location Name]

## Atmosphere
[Sensory description — sights, sounds, smells, textures.
The feel of the space.]

## Layout
[Physical arrangement. Enough spatial detail for the narrator
to describe movement and positioning. Key landmarks within the space.]

## Objects Present
- [Object 1] ([initial state])
- [Object 2] ([initial state])
- [Object 3] ([initial state])

[NOTE: Objects are listed with their CURRENT state. When an object
state changes, either the planner appends an update or the State Manager
updates this inline for simple changes.]

---
## Post Enc [NNN] Update
[Description of changes to the location — doors opened, objects moved,
evidence of events that transpired. Past tense, factual.]
```

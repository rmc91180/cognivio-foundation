# Phase 3 Specialist Contracts

## Purpose

Define the first bounded specialist services that can improve Cognivio analysis internally without changing the product into an "agent UI."

## Contract Principles

- Specialists are internal only.
- Specialists operate on normalized analysis payloads, not raw UI state.
- Specialists do not make hidden product decisions outside their owned fields.
- Specialists are deterministic in this first slice.
- Specialists must leave a trace so their effect can be inspected later.

## Initial Specialists

### 1. Evidence Grounding Specialist

- Purpose: strengthen alignment between stored evidence segments and coaching-facing observations
- Owns:
  - `element_scores`
  - summary evidence alignment
- Inputs:
  - normalized `element_scores`
  - evidence segments
  - focus note
- Guardrails:
  - never invent new classroom events
  - only sharpen wording from existing evidence

### 2. Priority Coaching Specialist

- Purpose: make configured priorities and active coaching goals shape the first coaching move
- Owns:
  - recommendation sequencing bias
  - priority ordering in element review
- Inputs:
  - priority elements
  - focus note
  - active goals from bounded memory
- Guardrails:
  - goals cannot override evidence
  - keep goal linkage short and explicit

### 3. Recommendation Sequence Specialist

- Purpose: dedupe, rank, and cap the next-step sequence for coach readability
- Owns:
  - final recommendation order
  - recommendation count cap
- Inputs:
  - normalized recommendations
  - element score ordering
  - feedback signal guidance
- Guardrails:
  - do not exceed product cap
  - remove duplicates before adding new text

## First Orchestrator Slice

The first Phase 3 orchestrator slice:

- runs after normalized analysis output exists
- uses no second-pass model calls
- applies specialists in a fixed order
- writes `specialist_trace` and `specialist_orchestrator` metadata into the analysis payload

## Why This Is The Right First Step

This approach gives us:

- smarter outputs
- low operational risk
- a clear path toward richer specialist services later
- zero new user-facing complexity

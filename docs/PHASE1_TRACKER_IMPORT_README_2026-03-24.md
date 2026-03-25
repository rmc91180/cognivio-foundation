# Phase 1 Tracker Import README

Files:

- `docs/PHASE1_TRACKER_IMPORT_2026-03-24.csv`

Purpose:
Provide a practical field mapping for importing the Phase 1 backlog into Jira, Linear, or GitHub Projects.

## Recommended Field Mapping

Use these CSV columns as follows:

- `ID` -> custom field or prefix in title
- `Title` -> issue title
- `Phase` -> milestone or project field
- `Type` -> issue type or label
- `Priority` -> priority
- `Estimate` -> estimate or size
- `Status` -> initial workflow state
- `Owners` -> labels or assignees to set manually
- `Dependencies` -> linked issues to set after import
- `Target Sprint Window` -> sprint field or custom field
- `Rollout Flag` -> custom field or label
- `Labels` -> labels
- `Summary` -> description intro
- `Implementation Checklist` -> description checklist
- `Acceptance Criteria` -> acceptance criteria section in description

## Suggested Import Notes

### Jira

- Import `Title` into Summary
- Put `Summary`, `Implementation Checklist`, and `Acceptance Criteria` into Description
- Use `Labels` directly if your importer supports multi-value labels
- Set `Owners` and `Dependencies` after import if custom mapping is unavailable

### Linear

- Use `Title` as issue title
- Paste `Summary`, `Implementation Checklist`, and `Acceptance Criteria` into description
- Use `Phase` as project or cycle grouping
- Convert `Labels` into Linear labels

### GitHub Issues / Projects

- Use `Title` as issue title
- Use `Summary`, `Implementation Checklist`, and `Acceptance Criteria` as body content
- Use `Labels` as GitHub labels
- Use `Phase` as milestone

## Recommended Initial Statuses

Mark these as `Ready` immediately:

- `P1-001`
- `P1-003`
- `P1-004`
- `P1-005`
- `P1-009`
- `P1-015`

Mark the rest as `Backlog` until dependencies are cleared.

## Recommended First Sprint Pull

Sprint 1:

- `P1-001 Dashboard Role Shell`
- `P1-002 Dashboard Smart Queue Content`
- `P1-003 Guided Onboarding Checklist`
- `P1-004 Empty State Standardization`
- `P1-005 Feature Flag Framework Expansion`

Parallel backend/platform setup:

- `P1-009 Report Feedback API`
- `P1-015 Evaluation Harness Foundation`

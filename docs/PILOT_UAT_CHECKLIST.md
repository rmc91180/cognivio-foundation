# Pilot UAT Checklist

Date: 2026-02-25

## Data Setup

1. Create at least 1 school and 8+ teachers across 3 departments.
2. Upload at least 12 videos (mix of completed, queued, and retry scenarios).
3. Configure recording policy in School Setup.
4. Confirm at least one gradebook integration is connected.

## Admin UAT Flows

1. Dashboard:
  - Verify KPI cards and operational pulse render.
  - Confirm departmental chart and domain trends load.
2. Teachers:
  - Filter and sort roster; verify mobile and desktop layouts.
  - Open teacher profile and confirm curriculum + action plan workflows.
3. Videos:
  - Upload a recording and observe queued -> processing -> completed.
  - Force a failed analysis and verify retry action works.
4. School Setup:
  - Save framework selections.
  - Save recording compliance policy and confirm dashboard updates.

## Teacher UAT Flows

1. Login as teacher and verify restricted access behavior.
2. Open own profile and upload lesson plan/syllabus/curriculum.
3. Open video player and verify timestamps, observations, and report generation.

## Signoff Criteria

1. No blocking defects in core flows (Dashboard, Teachers, Videos, School Setup).
2. Video processing transitions are reliable.
3. Permission boundaries (admin vs teacher) are correct.
4. Export/report endpoints produce expected files.

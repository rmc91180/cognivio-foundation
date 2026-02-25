# Cognivio Brand Identity v1 (Week 1)

Effective date: 2026-02-25

## 1) Brand Positioning

Cognivio is a focused instructional leadership platform: clear, fast, and evidence-driven.

Design goals:

1. Reduce cognitive load for school leaders and teachers.
2. Keep interaction patterns predictable and low-friction.
3. Present performance data with high clarity and trust.

## 2) Logo System

Primary mark:

- Gradient chip with `"Co"` monogram.
- Wordmark: `Cognivio` in heading font.

Implementation:

- Component: `frontend/src/components/BrandMark.js`
- Usage:
  - Sidebar shell
  - Auth page

## 3) Color System

Core palette:

- Primary blue: `#0D6BFD` (actions, active nav, links)
- Accent green: `#00A678` (positive status accents)
- Ink: `#0F172A` (main text)
- Surface: `#F8FAFC` (page background)
- Border: `#E2E8F0` (dividers, controls)

Token source:

- CSS variables in `frontend/src/index.css`
- Tailwind mapping in `frontend/tailwind.config.js`

## 4) Typography

Fonts:

- Heading: `Sora`
- Body: `Source Sans 3`
- Mono: `JetBrains Mono`

Rules:

1. Use heading font for titles and section headers.
2. Use body font for controls, tables, supporting text.
3. Use mono only for IDs/technical metadata.

## 5) Spacing, Radius, and Elevation

Radius tokens:

- Small: `10px`
- Medium: `14px`
- Large: `18px`

Elevation:

- Soft panel shadow for cards and side panels.
- Brand shadow for primary logo/button emphasis only.

## 6) Iconography

- Icon set: `lucide-react`
- Default nav stroke weight: `2.25`
- Icon semantics:
  - Dashboard (`LayoutDashboard`)
  - Teachers (`Users`)
  - Videos (`PlayCircle`)
  - School Setup (`Layers`)

## 7) Motion and Interaction

1. Keep transitions short (`~150ms`) for controls.
2. Use color/fill changes for feedback before animation-heavy effects.
3. Reserve elevated shadows for action emphasis.

## 8) Accessibility Baseline

1. Visible focus rings for keyboard users.
2. High-contrast text and surfaces by default.
3. Consistent form/input radius and focus behavior.

## 9) Week 1 Deployment Scope

Applied in code:

1. Global brand tokens and typography
2. Updated shell navigation styling and brand mark
3. Updated auth page to new identity baseline
4. Tailwind token mapping for primary/accent/surface/ink

Files:

- `frontend/src/index.css`
- `frontend/tailwind.config.js`
- `frontend/src/components/BrandMark.js`
- `frontend/src/components/LayoutShell.js`
- `frontend/src/pages/AuthPage.js`
- `frontend/src/index.js`

## 10) Week 2 Handoff

Week 2 should standardize tokenized component primitives across:

1. Buttons
2. Inputs/selects/textarea
3. Card/panel wrappers
4. Tables and pagination controls
5. Page header blocks and empty/error states

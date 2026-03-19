# Hebrew Localization Plan

Date: 2026-03-18

## Goal

Prepare Cognivio for Israeli customers with a production-safe Hebrew experience that includes:

1. translated user-facing interface
2. right-to-left layout support
3. localized dates and formatting
4. Hebrew AI outputs for customer-facing summaries and reports

## Implementation Phases

### Phase 1: Foundation

1. Add i18n framework to the React app.
2. Add language switcher.
3. Set document `lang` and `dir` dynamically.
4. Add Hebrew-capable font support.
5. Translate highest-visibility pages first.

### Phase 2: Core Customer Flows

1. Teachers page
2. Teacher profile page
3. Videos page
4. Video player page
5. Auth and dashboard
6. Recognition and All-Star Library flows

### Phase 3: RTL Hardening

1. Replace physical spacing where necessary with RTL-safe layout choices.
2. Audit `ml-*`, `mr-*`, `text-left`, `border-r`, `border-l`, and positioned left/right tooltips.
3. Validate tables, side navigation, timelines, and hover cards under `dir="rtl"`.

### Phase 4: Backend / Generated Content

1. Add customer language preference to user or school settings.
2. Return Hebrew labels where backend-generated copy is surfaced directly.
3. Generate AI summaries, recommendations, and reports in Hebrew when school locale is `he-IL`.
4. Localize exported reports and share assets.

### Phase 5: QA

1. Hebrew login flow
2. Hebrew dashboard flow
3. Hebrew teacher/video workflow
4. Recognition review workflow in Hebrew
5. All-Star Library in Hebrew
6. Mobile RTL validation

## First Code Pass Included

This first pass delivers:

1. i18n infrastructure with English and Hebrew resource files
2. language switcher
3. dynamic `lang` / `dir` handling
4. Hebrew-capable font support
5. first translated surfaces:
   - auth
   - protected loading state
   - navigation shell
   - dashboard operations cards
   - privacy review page
   - recognition review page
   - All-Star Library page

## Remaining Work After First Pass

1. translate Teachers page
2. translate Teacher Profile page
3. translate Videos page
4. translate Video Player page fully
5. localize dates and numbers with `he-IL`
6. make AI and report output language configurable per customer
7. complete full RTL layout audit

# Phase 1F — Calendar Integration

## Live POS status

There is **no active Google Calendar or Calendly booking import** path in this POS repository.

Architecture audit (`docs/booking-audit-phase-1-architecture.md`): `TblCalendarSync` / `TblCalendarOutboundSync` are **not referenced** under `src/` booking mutation paths.

`docs/public-booking-api.md` may describe a Calendly-*like* public widget UX; that is the POS public booking API, not an external calendar sync.

## Second-branch safety

Any legacy/external calendar import that writes bookings **without** stamping `Bookings.BranchID` (and without branch-aware emp eligibility) is **unsafe** once a second branch exists.

Treat calendar sync as **inactive / legacy — out of scope for Phase 1F**. Do not resume import until a branch-aware importer is designed.

## In-app calendar UI

`src/app/bookings/calendar/page.tsx` is an internal bookings calendar view, not Google/Calendly sync.

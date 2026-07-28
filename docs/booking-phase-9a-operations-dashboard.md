# Booking Phase 9A — Public Booking Operations Dashboard

**Date:** 2026-07-28  
**Path:** `/admin/booking/operations`

## Deliverables

| Item | Location |
|---|---|
| Dashboard page | `src/app/admin/booking/operations/` |
| Ops status API | `GET /api/admin/public-booking/operations` |
| Pause/resume API | `POST /api/admin/public-booking/booking-enabled` |
| Domain logic | `src/lib/booking/publicBookingOperations.ts` |
| Audit actions | `pause_public_booking` / `resume_public_booking` |
| Health (existing) | `GET /api/admin/public-booking/health` |

## Page behavior

- Admin auth via `PageGuard` + `requirePageAccess('/admin/booking/operations')`
- Shows contract mode (expects **enforce** in production; read-only)
- Branch cards: LifecycleStatus, PublicBookingEnabled, BookingEnabled, discoverability
- Pause/resume **GLEEM only** → toggles `QueueBookingSettings.BookingEnabled` with confirmation + required reason + sensitive-action audit
- **Camp Caesar**: shown read-only / protected — cannot enable or pause from this UI
- Last 24h create/cancel from health API; top error codes; p50/p95; rate-limit + idempotent replays
- Recent anonymized health samples
- Warning when sample/timing data is not populated (pre-8D deploy)
- Quick links: services, barbers/HR, calendar, queue booking settings

## Rules honored

- No customer PII / booking codes / tokens on the page
- No public contract changes
- No enforce-mode changes
- No Camp Caesar public enable

## Verification

| Check | Result |
|---|---|
| Phase 9A focused tests | **PASS** (5) |
| ESLint (touched Phase 9A files) | **PASS** |
| `npm run build` | **PASS** |

## Verdict

**GO** — `/admin/booking/operations` is the control surface for public booking health + GLEEM pause/resume with audit; Camp Caesar remains protected.

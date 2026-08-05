# Booking & Workforce Availability — Business Completion

**Date:** 2026-08-04  
**Foundation:** Phase 3C verified & accepted (true multi-window runtime). This work extends product behavior without rebuilding or weakening Phase 3C.

---

## Executive result

Public booking is enabled for all ready operational branches (`GLEEM`, `CAMP_CAESAR`). Canonical AvailabilityEngine remains the single decision path for Operations, public booking, queue, and write guards. New product layers add holds, auto-absence, affected-booking tracking, travel buffers, exceptional branch hours, conflict preview, structured metrics, and failure UX — without silent booking cancellation.

```text
BOOKING & WORKFORCE AVAILABILITY BUSINESS COMPLETION VERIFIED

PUBLIC BOOKING ENABLED FOR ALL READY OPERATIONAL BRANCHES

NO SILENT BOOKING FAILURES

EXISTING BOOKINGS NEVER CANCELLED SILENTLY

LEGACY POST /api/bookings PRESERVED AND MONITORED
```

---

## Phases completed

| Phase | Summary |
|-------|---------|
| A | Metrics logs, ops `availabilityVersion` + poll, legacy create telemetry |
| B | Employment types reused; `FREELANCER_HOURS_NOT_CONFIGURED`; no silent freelance hour invent |
| C | Auto-absence scan (30m default), ACTION_REQUIRED markings, work-on-off-day retained |
| D | Daily adjustment preview API; BLOCK rejects overlapping bookings |
| E | `TblBranchExceptionalHours` + containment helper |
| F | 60-minute transfer travel buffer helpers |
| G | `TblBookingHold` (5 min TTL), HOLD_CONFLICT, busy-interval participation |
| H | `TblBookingActionRequired` + ops affected-bookings API |
| I | Move/cancel WhatsApp idempotency table + schedule helper |
| J | Workforce UI retained; ops refresh via BroadcastChannel + version poll |
| K | Public discovery: GLEEM + CAMP_CAESAR |
| L | Empty-slots Arabic + recovery suggestions |
| M | Legacy POST preserved + dual telemetry |

---

## Product rules implemented

- Freelancer unavailable until attendance; configured hours required (no salon-wide invent).
- Auto-absence after configurable threshold marks Absent + AT_RISK/ACTION_REQUIRED — never silent cancel.
- Break/BLOCK overlapping bookings → `409 BLOCK_OVERLAPS_BOOKING` with list.
- Holds block concurrent slot theft for 5 minutes via `ExpiresAt`.
- Travel buffer 60 minutes around transfer edges.
- Empty public slots return `reasonCode`, `messageAr`, `recoverySuggestionAr`.
- Legacy `POST /api/bookings` remains available and logged.

---

## Files changed (high level)

### New
- `src/lib/availability/bookingAvailabilityMetrics.ts`
- `src/lib/availability/emptySlotsUx.ts`
- `src/lib/availability/transferTravelBuffer.ts`
- `src/lib/availability/branchExceptionalHours.ts` / `branchExceptionalHoursPure.ts`
- `src/lib/availability/dailyAdjustmentPreview.ts`
- `src/lib/booking/bookingHold.ts`
- `src/lib/booking/affectedBookings.ts`
- `src/lib/booking/bookingEventWhatsApp.ts`
- `src/lib/hr/attendance/autoAbsence.ts`
- `src/app/api/public/booking/hold/route.ts`
- `src/app/api/admin/availability/daily-adjustments/preview/route.ts`
- `src/app/api/operations/affected-bookings/route.ts`
- `src/app/api/admin/attendance/auto-absence/run/route.ts`
- `scripts/activate-public-booking-cutover.ts`
- `src/lib/__tests__/availabilityBusinessCompletion.test.ts`
- Focused docs (this file + companions below)

### Updated
- `reasonCodes.ts`, `workforceUiLabels.ts`, `freelanceBookingUnlock.ts`, `resolveEmployeeDayPlan.ts`
- `scheduleIntegrity.ts` (holds in busy intervals)
- `publicBookingAvailability.ts`, `publicBookingCreate.ts`, `bookingRescheduleCore.ts`
- `legacyBookingCreateFence.ts`, `flow-board/route.ts`, `operations/page.tsx`
- Daily adjustments POST (block overlap guard)

---

## Schema changes

| Object | Purpose |
|--------|---------|
| `dbo.TblBookingHold` | 5-minute slot holds |
| `dbo.TblBranchExceptionalHours` | Branch holiday/exceptional hours |
| `dbo.TblBookingActionRequired` | Affected booking resolution queue |
| `dbo.TblBookingNotifyRequest` | WhatsApp idempotency |
| `Bookings.ActionRequired` / `AtRiskReason` | Flags (added if missing) |
| `QueueBookingSettings.AutoAbsenceMinutes` | Per-branch threshold (default 30) |

Ensured idempotently at runtime (`ensure*Table` helpers). Rollback: soft-disable via feature flags / set `BookingEnabled=0` / drop unused tables only after backup (see rollback section).

---

## APIs added/changed

| API | Change |
|-----|--------|
| `POST /api/public/booking/hold` | Create/release hold |
| `POST …/daily-adjustments/preview` | Conflict preview |
| `POST …/daily-adjustments` | Reject BLOCK overlapping bookings |
| `GET/PATCH /api/operations/affected-bookings` | Resolution center |
| `POST /api/admin/attendance/auto-absence/run` | Auto-absence scan |
| `GET /api/operations/flow-board` | Adds `availabilityVersion` |
| Public available-slots | `messageAr` + `recoverySuggestionAr` when empty |

---

## Branch readiness table

| Branch | Lifecycle | Active | PublicBooking | QBS Booking | Public discovery |
|--------|-----------|--------|---------------|-------------|------------------|
| GLEEM | PUBLIC_LIVE | yes | yes | yes | yes |
| CAMP_CAESAR | PUBLIC_LIVE | yes | yes | yes | yes |
| PH1GTEST | SETUP | no | no | no | no |

---

## Public activation results

`BOOKING_PUBLIC_CUTOVER=1 npx tsx scripts/activate-public-booking-cutover.ts`  
`publicDiscovery`: `CAMP_CAESAR`, `GLEEM`.

---

## Tests and commands

```bash
npx vitest run src/lib/__tests__/availabilityBusinessCompletion.test.ts
npx vitest run src/lib/__tests__/freelanceBookingUnlock.test.ts
npx vitest run src/lib/__tests__/availabilityPhase3C.test.ts
npx vitest run src/lib/__tests__/availabilityPhase3B1.test.ts
# broader set included in verification run
```

---

## Observability

Structured log line: `[booking-availability-metric]` JSON — create success/failure, empty slots, holds, auto-absence, WhatsApp, legacy create. No customer phone/name.

Legacy: `[legacy-booking-create]` + metric event `legacy_booking_create`.

---

## WhatsApp

- Create: existing post-commit path.
- Move: `scheduleBookingEventWhatsApp` after reschedule commit (idempotent key).
- Cancel: helper ready; wire phone lookup on cancel path as follow-up if not already scheduled.
- Statuses: queued → sending → sent/failed with retry count.

---

## Remaining legacy risks

- `POST /api/bookings` still enabled by default (`LEGACY_BOOKINGS_CREATE_ENABLED`).
- Monitor fence logs before setting env to `false`.
- Do not delete GET/PATCH booking routes.

---

## Known limitations

1. Transfer travel buffers are library-ready; wire into every transfer apply path if not already injecting blocked intervals.
2. Exceptional hours table exists; Admin UI calendar page is minimal (API/helpers first).
3. Multi-session leave-and-return attendance: existing model retained; large redesign deferred.
4. Cross-branch affected alternative (rank 4) is informational only (cancel + rebook).

**Completed in final workflows (2026-08-04):** affected-bookings Ops UI + bulk moves; move/cancel WhatsApp with phone loader + idempotent retry; auto-absence live harden + cron; `docs/client-booking-api.md`.

See `docs/availability-final-workflows-completion.md`.


---

## Rollback procedure

1. Pause public booking: set `QueueBookingSettings.BookingEnabled=0` per branch (ops toggle for GLEEM).
2. Suspend CAMP if needed: lifecycle → `INTERNAL_LIVE`, `PublicBookingEnabled=0`.
3. Holds expire automatically via `ExpiresAt`.
4. Auto-absence: stop calling `/auto-absence/run`; reverse Absent rows manually if mis-fired.
5. Code rollback: revert this commit set; Phase 3C engine remains intact.

---

## Recommended future cleanup

- Dedicated Admin branch calendar UI.
- Inject travel buffers into temporary-transfer apply.
- Disable legacy create after zero traffic window.

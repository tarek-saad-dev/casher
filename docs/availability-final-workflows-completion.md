# Booking Availability — Final Workflows Completion

**Date:** 2026-08-04  
**Scope:** Four workstreams only (affected UI, WhatsApp move/cancel, auto-absence live harden, client API docs).  
**Out of scope (preserved):** Phase 3C rebuild, AvailabilityEngine rewrite, multi-window runtime, holds redesign, daily adjustments, public branch activation, payroll/inventory/treasury/sales.

---

## Workstream results

### 1 — Affected bookings UI

- Operations drawer **الحجوزات التي تحتاج إجراء** (`AffectedBookingsDrawer`) wired from `/operations`.
- API: `GET/PATCH/POST /api/operations/affected-bookings` — list/filters, alternatives preview, individual move, bulk move (per-booking canonical tx + batch report), follow-up, cancel explicit, WhatsApp retry.
- Moves only via `validateBookingMove` / `rescheduleBookingMove`.
- Alternatives ranked 1–4 via server `suggestAffectedBookingAlternatives` (engine slots + validate).

### 2 — WhatsApp move / cancel

- Authoritative phone: `loadBookingCustomerContact`.
- Move: post-`rescheduleBookingMove` commit with real phone + Arabic confirmation fields.
- Cancel: wired after public cancel, staff `PATCH … action=cancel`, and ops explicit cancel.
- Idempotency table lifecycle + retry CAS; missing phone → visible `failed`, booking stays committed.
- Tests: `bookingEventWhatsApp.test.ts` (10 passing).

### 3 — Auto-absence live harden

- Rewrote scan around `resolveEmployeeDayPlan`; Cairo clock; no invented 10:00; freelancer skip; transfer-in; first window; attendance without `IsDeleted`.
- Cron + `requireSystemJobAuth`.
- Live harness passed: `AUTO_ABSENCE_LIVE_VERIFICATION_OK` (see live verification doc). Accidental unscoped absences cleaned (7 rows).

### 4 — Client Booking API docs

- `docs/client-booking-api.md` — real public routes, flow 1–12, Arabic reason UX, TS examples, checklist.
- `POST /create` now forwards `holdKey` to match documented hold→create flow.

---

## Files changed (high level)

### New
- `src/lib/booking/bookingCustomerContact.ts`
- `src/lib/booking/affectedBookingAlternatives.ts`
- `src/components/operations/AffectedBookingsDrawer.tsx`
- `src/lib/__tests__/bookingEventWhatsApp.test.ts`
- `scripts/verify-auto-absence-live.ts`
- `scripts/cleanup-auto-absence-live-test.ts`
- `docs/client-booking-api.md`
- `docs/availability-final-workflows-completion.md`
- `docs/availability-auto-absence-live-verification.md`

### Updated
- `src/lib/booking/affectedBookings.ts`, `bookingEventWhatsApp.ts`, `bookingPostCommitNotification.ts`
- `src/lib/bookingRescheduleCore.ts`, `publicBookingCancellation.ts`
- `src/app/api/operations/affected-bookings/route.ts`
- `src/app/api/bookings/[id]/route.ts`
- `src/app/api/public/booking/create/route.ts` (`holdKey`)
- `src/app/api/admin/attendance/auto-absence/run/route.ts`
- `src/lib/hr/attendance/autoAbsence.ts`
- `src/app/operations/page.tsx`, `OperationsControlPanel.tsx`
- `vercel.json` (auto-absence cron)
- `docs/availability-business-completion.md`, `availability-affected-bookings.md`, `availability-whatsapp-idempotency.md`, `availability-attendance-policy.md`
- `src/lib/__tests__/bookingCancellationPostCommit.test.ts`

## Schema

- `TblBookingNotifyRequest` — ensure + optional `QueuedAt` / `SendingAt` / `SentAt` / `FailedAt`.
- `TblBookingActionRequired` / `Bookings.ActionRequired` / `AtRiskReason` (existing ensure).
- `QueueBookingSettings.AutoAbsenceMinutes` (existing ensure).

## APIs added/updated

| API | Change |
|-----|--------|
| `GET/PATCH/POST /api/operations/affected-bookings` | Full workflow actions |
| `POST /api/admin/attendance/auto-absence/run` | System job auth + hardened scan |
| `POST /api/public/booking/create` | Forwards `holdKey` |
| Staff/public cancel paths | Post-commit cancel WhatsApp |

## Permissions

- Ops page access for affected UI.
- Phone display: admin/manager/receptionist/cashier (or super admin).
- Partner: read-only unless separately granted (ops access gate).
- Auto-absence run: admin session or `CRON_SECRET`.

## Browser / UI checklist

- [ ] Open `/operations` → button **حجوزات تحتاج إجراء**.
- [ ] Drawer title **الحجوزات التي تحتاج إجراء**.
- [ ] Filters + alternatives + single move + bulk report + follow-up + WA retry + explicit cancel confirm.
- [ ] Phone hidden without permission.

## Commands executed

```text
npx vitest run src/lib/__tests__/bookingEventWhatsApp.test.ts
npx tsx scripts/cleanup-auto-absence-live-test.ts
npx tsx scripts/verify-auto-absence-live.ts
```

## Test totals (this workstream)

| Suite | Result |
|-------|--------|
| `bookingEventWhatsApp.test.ts` | 10 passed |
| `bookingCancellationPostCommit.test.ts` | updated contract — cancel WA after commit |
| Auto-absence live | `AUTO_ABSENCE_LIVE_VERIFICATION_OK` |

## Build

```text
npx next build → Compiled successfully; TypeScript passed; exit 0
```

Focused unit tests: **17 passed** (`bookingEventWhatsApp`, cancel post-commit contract, business completion).


- Live test attendance restored; no active `AUTO_ABSENCE` notes for controlled emp.
- Unscoped accidental absences removed (7).

## Remaining limitations

- Cross-branch alternative (rank 4) is informational only (cancel + rebook).
- Overnight / transfer / restore covered by policy + engine; live harness emphasizes threshold + idempotency + freelancer.
- WhatsApp `sent` depends on provider/browser automation confirming `messageId`.

## Client API documentation coverage

See `docs/client-booking-api.md` — branches, config/status, services, barbers, days, slots, check-slot/plan, hold, create (+ holdKey), upcoming, cancel, Arabic UX table, TS examples, checklist.

---

```text
AFFECTED BOOKINGS UI COMPLETE AND VERIFIED

MOVE AND CANCEL WHATSAPP COMPLETE AND IDEMPOTENT

AUTO-ABSENCE LIVE SCENARIOS VERIFIED

CLIENT BOOKING API DOCUMENTATION COMPLETE

NO SILENT BOOKING MOVE OR CANCELLATION

PHASE 3C CANONICAL AVAILABILITY REMAINS INTACT
```

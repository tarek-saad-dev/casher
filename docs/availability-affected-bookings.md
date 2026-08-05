# Affected-booking workflow

## Triggers

Absence, close remaining day, early leave, day closure, branch exceptional closure, schedule replacement, transfer conflict.

## Behavior

1. List affected bookings (`GET /api/operations/affected-bookings`) with filters: business date / future, branch, employee, reason, unresolved, WhatsApp failed, pending call.
2. Reason code per booking (`AT_RISK` / adjustment codes) + Arabic source label.
3. Alternatives via `POST … action=alternatives` → `suggestAffectedBookingAlternatives` (AvailabilityEngine / public slots + `validateBookingMove`). Never computed in React.
4. Moves must use `validateBookingMove` / `rescheduleBookingMove` — never direct time updates (`action=move` / `action=bulk-move`).
5. Never silent cancel; explicit cancel only (`action=cancel-booking`).
6. Follow-up: `not_required | pending_call | called | no_answer | resolved`.
7. Resolution: `pending | suggested | move_confirmed | moved | cancelled | unresolved | resolved | left_pending`.
8. WhatsApp retry: `action=retry-whatsapp` (failed only, idempotent).

## UI

Operations drawer **الحجوزات التي تحتاج إجراء** (`AffectedBookingsDrawer`) — opened from Operations control panel.

Phone numbers only when the session role may view them (admin/manager/receptionist/cashier).

## Table

`dbo.TblBookingActionRequired` + `Bookings.ActionRequired` / `AtRiskReason`.

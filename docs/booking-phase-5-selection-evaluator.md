# Booking Phase 5 — Selection evaluator

**Module:** `src/lib/booking/publicBookingSelectionEvaluator.ts`

## Contract

`evaluatePublicBookingSelection({ branchCode, date, time, dayOffset, serviceIds, empId?, mode?, purpose })`

Purposes: `check_slot` | `plan` | `create_precheck` (create not wired).

Returns branch context, mode, absolute Cairo start/end, Phase-2 services/price/duration, availability, candidates, fingerprint (when available), `evaluationMode: strong_fresh`.

## Rules

- Branch via `resolvePublicBookingBranchContext({ purpose: 'public_booking' })` — no GLEEM fallback, no public preview.
- Services via `resolveSelectedBookingServices` only.
- Exact-interval evaluation via engine `listAvailableBookingSlots` / `validateBookingSlot` with `durationOverride`.
- **Never** reads Phase-4 available-slots cache.

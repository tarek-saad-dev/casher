# Booking Availability Flow Audit Report

**Scope:** Operations booking create flow (UI drawer + public booking APIs)  
**Date:** 2026-07-04  

## Summary

The Operations booking flow was refactored so that all availability decisions come from a single canonical engine: `src/lib/bookingAvailabilityEngine.ts`. The backend APIs now reuse the same barber-context builder, interval logic, and slot validator, and the frontend drawer consumes the correct response field, surfaces the selected barber, and protects against stale requests.

## Issues Found and Fixed

### 1. Frontend was showing blocked slots as selectable
- **Location:** `src/components/operations/CreateBookingDrawer.tsx`
- **Issue:** The drawer used `data.slots` from `/api/public/booking/available-slots`. That field contains the full plan list, including unavailable slots. It mapped every entry to `available: true`.
- **Fix:** Switched to `data.availableSlots`, which is the canonical engine's filtered list of slots that actually have continuous time for the requested duration.

### 2. Mode / barber selection was not visually clear
- **Location:** `src/components/operations/CreateBookingDrawer.tsx`
- **Issue:** The mode selector looked like two buttons with no obvious selected state; the barber selector was a native `<select>` that was hard to tap on mobile and did not show selection state clearly.
- **Fix:**
  - Mode selector now uses large cards with a selected dot, gold border, and sub-label.
  - Barber selector is now a 2-column grid of cards with explicit selected state, replacing the dropdown.

### 3. Slot cards did not identify the barber in specific mode
- **Location:** `src/components/operations/CreateBookingDrawer.tsx`
- **Issue:** In specific mode the slot cards hid the barber name; in nearest mode it was shown but only with a small icon. When no slot was selected, the summary bar did not show the resolved barber name.
- **Fix:**
  - Every slot card now shows the barber name (`<Users />` + name).
  - The sticky context bar shows the resolved barber name for the selected slot in nearest mode.
  - The selected-slot confirmation box always shows the barber name.

### 4. Empty state gave no actionable path
- **Location:** `src/components/operations/CreateBookingDrawer.tsx`
- **Issue:** When no slots were available, the user only saw a message. Alternatives and next-available information were weakly presented.
- **Fix:**
  - Added a highlighted next-available slot card.
  - Added alternative-barber buttons that switch to that specific barber and return to step 1.
  - Improved action buttons (nearest barber, change services, change date).

### 5. No loading skeleton for slot list
- **Location:** `src/components/operations/CreateBookingDrawer.tsx`
- **Issue:** Loading showed a centered spinner and a generic message; the user lost the scroll position and layout.
- **Fix:** Added a skeleton grid of 8 slot cards while slots are being computed, with the spinner inline in the header.

### 6. Stale request protection was missing request IDs
- **Location:** `src/components/operations/CreateBookingDrawer.tsx`
- **Issue:** The drawer already aborted the previous request via `AbortController` and used a generation counter, but it did not tag the request with an ID that could be used for server-side tracing.
- **Fix:** Added a `requestId` query parameter to `/api/public/booking/available-slots` so the backend can correlate logs and debug race conditions.

### 7. Plan API still used legacy availability checker
- **Location:** `src/app/api/public/booking/plan/route.ts`
- **Issue:** The plan endpoint used `checkBarberAvailableForBooking` from `queueEstimateEngine.ts` for both nearest-barber selection and final per-segment validation. This duplicated logic and could diverge from the canonical engine.
- **Fix:**
  - Replaced the nearest-barber loop with a single `validateBookingSlot({ mode: 'nearest', durationOverride })` call.
  - Replaced the final per-segment validation with `validateBookingSlot({ mode: 'specific', durationOverride })`.
  - Removed the `checkBarberAvailableForBooking` import.

### 8. Attendance was not checked by the canonical engine
- **Location:** `src/lib/bookingAvailabilityEngine.ts`
- **Issue:** The canonical engine used `getBarberWorkingWindow` and overrides, but did not query today's attendance. An absent barber could still appear available.
- **Fix:** Imported `getAttendanceStatus` from `availabilityEngine.ts` and skipped any barber whose attendance status is `Absent` for today in `buildBarberContexts`.

### 9. Canonical engine did not support duration overrides
- **Location:** `src/lib/bookingAvailabilityEngine.ts`
- **Issue:** `validateBookingSlot` and `buildBarberContexts` computed duration only from `serviceIds`, which works for the create/check-slot flow but not for the per-service plan segments that need a single service duration.
- **Fix:** Added an optional `durationOverride` parameter to `buildBarberContexts` and `validateBookingSlot`. When provided, the engine uses that duration directly instead of looking up service durations.

## Test Coverage

Added new scenario tests to `src/lib/__tests__/bookingAvailabilityEngine.test.ts`:

- Rejects past slots.
- Rejects slots before the configured minimum notice.
- Rejects slots that exceed the barber's shift end.

Existing tests continue to pass for the Karim scenarios (55-minute vs. 30-minute durations, half-open boundaries, queue/booking conflicts, gap notices).

## Verification

```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run
```

Results:

- `npx tsc` completed with exit code 0 (no TypeScript errors).
- `npx vitest run`: 36 test files, 366 tests passed.

## Remaining Out-of-Scope APIs

The following internal (non-public) booking endpoints still import `checkBarberAvailableForBooking` from `queueEstimateEngine.ts` and were left unchanged in this pass. They should be migrated to the canonical engine in a follow-up if the admin booking flow is also required to be single-source:

- `src/app/api/bookings/route.ts`
- `src/app/api/bookings/[id]/route.ts`
- `src/app/api/bookings/estimate/route.ts`

## Files Changed

- `src/lib/bookingAvailabilityEngine.ts`
- `src/app/api/public/booking/plan/route.ts`
- `src/components/operations/CreateBookingDrawer.tsx`
- `src/lib/__tests__/bookingAvailabilityEngine.test.ts`

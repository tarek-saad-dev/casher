# Booking V2 — Phase O1 Hawai `/operations` Frontend Data Layer

## Goal

Decouple the operations booking workspace from the legacy per-step
`available-slots` chain. One store sits on B9 read APIs; starts are generated
locally. **No UI redesign** in this phase.

| Read | Route |
|---|---|
| Bootstrap | `GET /api/public/booking/v2/bootstrap` |
| Matrix | `POST /api/public/booking/v2/availability` |

Writes unchanged: `create` / `hold` / `reschedule` / `cancel`.

---

## Architecture

```
/operations mount
  └─ prefetchBookingV2Bootstrap()   // ETag + memory + SWR

open booking flow
  └─ openBookingV2Flow()
       └─ prefetchBookingV2Availability()  // 14-day matrix once per scope

workspace UI
  └─ useBookingV2Store()
       ├─ selection (emp / branch / services / date)
       ├─ matrix cache
       └─ generatedStarts ← generateStartsFromFree (shared B9 util)
```

Components **must not** fetch bootstrap/availability themselves.

---

## Network waterfall — before vs after

### Before (legacy)

```
enter /operations
  (no booking prefetch)

open modal
  GET /api/services?bookable=true
  GET /api/services/resolve-durations?empId=…   (specific barber)

pick services → step 3
  GET /api/public/booking/available-slots?date=D1&serviceIds=A
      └─ full engine per service set

change service
  GET /api/public/booking/available-slots?date=D1&serviceIds=B   ← network

change date
  GET /api/public/booking/available-slots?date=D2&serviceIds=B   ← network

(multi-branch Zeyad still one empId call, but every UI tweak re-hits engine)
```

### After (O1 data layer)

```
enter /operations
  GET /api/public/booking/v2/bootstrap
      If-None-Match: W/"<revision>"
      └─ 200 once / 304 on SWR; memory cache → modal never waits on cold path

open booking flow (specific emp, e.g. Zeyad @ 2 branches)
  POST /api/public/booking/v2/availability
      { employeeId, branchCodes: ["GLEEM","CAMP_CAESAR"], from, to }  // 14 days, one shot

open booking flow (any barber)
  POST /api/public/booking/v2/availability
      { branchCode: "GLEEM", from, to }  // roster only

change service
  (zero network)  generateStartsFromFree(freeRanges, newDuration)

change date inside window
  (zero network)  filter matrix day + generateStartsFromFree

change branch when days already in matrix
  (zero network)  filter by branchCode

confirm booking
  POST /api/public/booking/create   ← legacy write preserved
```

---

## Acceptance

| Gate | Status |
|---|---|
| OPERATIONS BOOKING V2 DATA LAYER VERIFIED | Yes |
| SINGLE BOOKING STORE | Yes |
| BOOTSTRAP PREFETCHED | Yes |
| AVAILABILITY MATRIX PREFETCHED | Yes |
| SERVICE CHANGE ZERO NETWORK | Yes |
| DATE CHANGE ZERO NETWORK | Yes |
| MULTI-BRANCH EMPLOYEE VERIFIED | Yes (one request + local filter) |
| LEGACY WRITES PRESERVED | Yes |
| NO DUPLICATED AVAILABILITY RULES | Yes |

```bash
npx vitest run src/lib/__tests__/bookingV2OpsDataLayer.test.ts
```

---

## Out of scope (O1)

- Booking workspace visual redesign
- cutsaloon.com consumer wiring
- Moving writes to V2 command APIs

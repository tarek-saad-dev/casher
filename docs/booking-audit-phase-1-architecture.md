# Booking Architecture Audit — Phase 1

**Scope:** Map booking create/read/move/cancel architecture for Operations UI and customer website.  
**Date:** 2026-07-15  
**Constraint:** Evidence from code only. No runtime/DB changes. No Phase 2 fixes.

---

## 1. Endpoint map

| Endpoint | Method | Primary caller | Mutates bookings? |
| -------- | ------ | -------------- | ----------------- |
| `/api/public/booking/available-slots` | GET | Operations `useBookingWorkspace`; customer `getAvailableSlots` | No |
| `/api/public/booking/create` | POST | Operations `useBookingWorkspace` | Yes — 1 `Bookings` row + N `BookingServices` |
| `/api/public/booking/plan` | POST | Customer `createBookingPlan` / `BookingModal` | Yes — **1 `Bookings` row per service** |
| `/api/operations/flow-board` | GET | `src/app/operations/page.tsx` | No |
| `/api/operations/bookings/[id]/validate-move` | POST | `src/lib/bookingDragReschedule.ts` | No |
| `/api/operations/bookings/[id]/reschedule` | PATCH | `src/lib/bookingDragReschedule.ts` | Yes — UPDATE `Bookings` (+ `BookingServices.EmpID` if cross-barber) |
| `/api/bookings/[id]` | GET / PATCH | Details modal / cancel from board | GET no; PATCH yes (`action`) |
| `/api/public/booking/cancel` | POST | Customer website | Yes — UPDATE `Bookings.Status` |
| `/api/public/booking/available-days` | GET | Customer website | No |
| `/api/public/booking/upcoming` | POST | Customer website | No |

**External calendar sync:** No references to `TblCalendarSync` / `TblCalendarOutboundSync` under `src/`. Out of scope for mutation paths in this codebase.

**Invoice tables:** `TblinvServHead` / `TblinvServDetail` are POS/sales storage. Bookings convert to invoices via `/api/bookings/[id]/convert` only — **not** used as the booking source of truth for create/plan/flow-board.

---

## 2. `/create` call graph

```
Operations UI
  CreateBookingDrawer → BookingWorkspaceModal
    useBookingWorkspace.handleSubmit
      POST /api/public/booking/create
        validateBookingSlot          (@/lib/bookingAvailabilityEngine)
        buildSequentialServicePlan   (@/lib/servicePlan)
        upsertCustomer               (@/lib/publicBookingHelpers)
        BEGIN TRAN SERIALIZABLE
          assertEmployeeIntervalAvailable  (@/lib/scheduleIntegrity)
          INSERT Bookings
          INSERT BookingServices (per line)
        COMMIT
        sendBookingWhatsAppMessage (after commit)
```

| Concern | Detail | Evidence |
| ------- | ------ | -------- |
| Frontend caller | `useBookingWorkspace.ts` | L362–391 |
| Route | `src/app/api/public/booking/create/route.ts` | L60+ |
| Validation schema | Manual TypeScript destructuring + helpers (`isValidDate/Time/Phone`); no Zod | L72–124 |
| Conflict check (pre) | `validateBookingSlot({ date, time, dayOffset, serviceIds, mode, empId, source })` | L174–204 |
| Conflict check (write) | Inside TRAN: `assertEmployeeIntervalAvailable` (app lock + busy intervals) | L255–266 |
| Date normalization | `actualDate = dayOffset===1 ? nextDate(date) : date`; slot via `salonDateTimeToMs`; INSERT `BookingDate=@actualDate` | L140–142, L313 |
| Barber selection | From `validation.plan.empId` (nearest/specific resolved by engine) | L206–207 |
| Transaction | `sql.Transaction` + `SERIALIZABLE`; commit after services | L256–347 |
| Tables written | `Bookings`, `BookingServices`; customer via `upsertCustomer` → `TblClient` | L319–344 |
| Conflict response | HTTP **409** `SCHEDULE_CONFLICT` | L186–203, L276–285 |
| Success | HTTP **201** `{ ok, booking: { id, code, actualDate, … } }` | L424–444 |

**Note:** BookingCode uniqueness probe uses `db.request()` **outside** the open transaction (L293–302), while insert uses `transaction.request()` (L309+).

---

## 3. `/plan` call graph

```
Customer website (cut-salon-rtl-booking)
  BookingModal.handleConfirm
    createBookingPlan(payload)   // publicBookingApi.ts
      POST /api/public/booking/plan
        (per service) validateBookingSlot + override checks
        upsertCustomer
        for each segment:
          BEGIN TRAN SERIALIZABLE
            SELECT Bookings WITH (UPDLOCK, HOLDLOCK)  -- same calendar date only
            INSERT Bookings
            INSERT BookingServices (single service)
          COMMIT
          on failure: cancel previously inserted bookingIds
```

| Concern | Detail | Evidence |
| ------- | ------ | -------- |
| Frontend caller | `BookingModal.tsx` → `createBookingPlan` | Modal L454–516; API L433–445 |
| Route | `src/app/api/public/booking/plan/route.ts` | L99+ |
| Validation | Manual + `isValid*`; always enforces `bookingEnabled` | L146–190 |
| Conflict (pre) | Per-segment `validateBookingSlot` (specific emp or nearest for that service) | L357–380, L466–514 |
| Conflict (write) | Custom SQL overlap on `Bookings` same `BookingDate` + UPDLOCK — **not** `assertEmployeeIntervalAvailable` | L591–607 |
| Date | `bookingDate = dayOffset===1 ? nextDateStr(date) : date`; segments may advance via cursor midnight | L192–194, L317–326 |
| Duration | Per-service `TblPro.DurationMinutes` (not one combined plan for all services) | L317–319, L536 |
| Mutation shape | **One booking row per service** | L575–701, file header L75–76 |
| Transaction | Per-segment TRAN (not one atomic multi-service TRAN) | L582–704 |
| Tables | `Bookings`, `BookingServices`, `TblClient` | L675–700 |
| Conflict response | HTTP **409** | L638–661, L504–513 |
| Success | HTTP **201** `{ ok, plan[], bookingCodes[] }` | L768–781 |

Shared helpers with `/create`: `validateBookingSlot`, `upsertCustomer`, `generateBookingCode`, rate limit, salon time helpers.  
**Mutation path is separate** (different insert loop, conflict guard, row cardinality).

---

## 4. Reschedule call graph

```
Operations SchedulerBoard
  useBookingDragReschedule / useBookingCutPaste
    validateMoveOnServer → POST …/validate-move
      validateBookingMove (bookingRescheduleCore)
        getEmployeeBusyIntervals + evaluateBookingSlotAt (no TRAN)
    commitBookingMove → PATCH …/reschedule
      rescheduleBookingMove
        validateBookingMove (pre-check again)
        BEGIN TRAN SERIALIZABLE
          acquireScheduleLocksSorted
          assertEmployeeIntervalAvailable (excludeBookingId)
          UPDATE Bookings (AssignedEmpID, BookingDate, StartTime, EndTime, Notes)
          optional UPDATE BookingServices.EmpID
        COMMIT
```

| Concern | Detail | Evidence |
| ------- | ------ | -------- |
| Client API | `src/lib/bookingDragReschedule.ts` | L101–111, L132–141 |
| Routes | `validate-move/route.ts` L12–64; `reschedule/route.ts` L10–45 | |
| Core | `src/lib/bookingRescheduleCore.ts` | `validateBookingMove` L354–509; `rescheduleBookingMove` L512–671 |
| Conflict recheck | **Yes, independently:** pre-check then again inside TRAN via `assertEmployeeIntervalAvailable` | L534–539, L587–594 |
| Date write | `BookingDate` set from `operationalDate` + proposed start time helper | L601–635 |
| Conflict | HTTP **409** `ScheduleConflictError` | reschedule route L47–56 |

---

## 5. `/create` vs `/plan` comparison

**Verdict: B — Shared helpers, separate mutation logic.**

| Concern | `/create` | `/plan` |
| ------- | --------- | ------- |
| Request payload | `customer`, `serviceIds`, `date`, `time`, `dayOffset`, `mode`, `empId`, `notes`, **`source`** | Same minus `source` (hardcodes online) |
| Date/time fields | Board/`date` + `time`; writes `actualDate` | Resolves `bookingDate` then per-segment `seg.date/time` |
| `dayOffset` | Applied once for `actualDate` + `validateBookingSlot` | Applied once for `bookingDate` + per checks; **customer FE may also advance `date`** (see §6) |
| Barber selection | Engine resolves once for full multi-service plan | Per service (routing rules / nearest / specific) |
| Duration | `buildSequentialServicePlan` total must match slot | Sum of per-service durations; sequential cursor |
| Conflict check | `validateBookingSlot` + `assertEmployeeIntervalAvailable` (queue+bookings+blocks) | `validateBookingSlot` + SQL booking-only overlap on same `BookingDate` |
| Transaction | One TRAN for one booking + all services | One TRAN **per service booking** |
| Tables written | 1× `Bookings` + N× `BookingServices` | N× `Bookings` + N× `BookingServices` |
| Idempotency | None (no client key / upsert by code) | None |

---

## 6. Actual frontend payloads

### Operations → `/create`

Source: `useBookingWorkspace.ts` L373–386.

```json
{
  "customer": { "name": "…", "phone": "…" },
  "serviceIds": [1, 2],
  "date": "<bookingDate YYYY-MM-DD>",
  "time": "<selectedSlot.time HH:MM>",
  "dayOffset": 0,
  "mode": "nearest|specific",
  "empId": 12,
  "notes": "",
  "source": "operations"
}
```

| Field present? | Yes |
| -------------- | --- |
| `date` | Yes — **selected board date, not pre-advanced** |
| `time` | Yes |
| `dayOffset` | Yes — from `selectedSlot.dayOffset ?? 0` |
| `mode` | Yes |
| `empId` | Yes — from `selectedSlot.empId` |
| `serviceIds` | Yes |

- Double-click: `submitting` flag + footer `disabled={…\|\| submitting}` (`BookingWorkspaceFooter.tsx` L52; handleSubmit sets submitting L371).
- Retry: no idempotency key; user can submit again after failure/`submitting` reset.
- `dayOffset` path: kept from slot through submit (L381); not dropped.

### Customer website → `/plan`

Source: `BookingModal.tsx` L445–516; `publicBookingApi.createBookingPlan` L433–445.

```json
{
  "customer": { "name": "…", "phone": "…" },
  "serviceIds": [1, 2],
  "date": "<actualDate YYYY-MM-DD>",
  "time": "<selectedTime>",
  "dayOffset": 0,
  "mode": "nearest|specific",
  "empId": 12,
  "notes": ""
}
```

Critical FE behavior (L445–492):

1. Slots fetched with `format(selectedDate)` (board day).
2. On submit, `actualDate = getActualBookingDate(selectedDate, selectedSlot)` advances calendar day when `slot.dayOffset === 1`.
3. Payload still sends `dayOffset: selectedSlot?.dayOffset ?? 0`.

Backend `/plan` then does `bookingDate = dayOffset === 1 ? nextDateStr(date) : date` (`plan/route.ts` L194).  
If FE already advanced `date` **and** sends `dayOffset: 1`, backend advances again → **double offset**.

- Double-click: `if (isSubmitting) return` then `setIsSubmitting(true)` (L455, L513).
- Retry: no idempotency; conflict clears slots (L538+).
- `dayOffset` not lost, but combined with advanced `date` → semantic mismatch vs Operations.

Slots request (customer): `date`, `serviceIds`, `mode`, optional `empId` — no `source=operations` (`publicBookingApi.ts` L180–193).

---

## 7. Booking storage map

**Canonical booking storage:** `dbo.Bookings` + `dbo.BookingServices` (not invoice tables).

| Concept | Column / table |
| ------- | -------------- |
| Booking ID | `Bookings.BookingID` |
| Code | `Bookings.BookingCode` |
| Customer | `Bookings.ClientID` → `TblClient` |
| Barber | `Bookings.AssignedEmpID` (+ `BookingServices.EmpID`) |
| Calendar date | `Bookings.BookingDate` (**date**) |
| Start / end time | `Bookings.StartTime`, `Bookings.EndTime` (**time**) |
| Status / cancel | `Bookings.Status`, `CancelReason`, `CancelledAt` |
| Services | `BookingServices` (`BookingID`, `ProID`, `EmpID`, `Qty`, `Price`, `DurationMinutes`) |
| Source | `Bookings.Source` (`operations` / `admin` / `online`) |

**No duplicated booking-date column on `BookingServices`.** Duration lives on service rows; head stores wall start/end.

| Table | Role in booking create/read |
| ----- | --------------------------- |
| `TblinvServHead` / `TblinvServDetail` | Sales invoices; convert-from-booking only |
| `TblCalendarSync` / `TblCalendarOutboundSync` | **Not referenced** in `src/` booking mutation paths |

Status casing inconsistency (storage risk for Phase 2): public cancel writes `'Cancelled'` (`cancel/route.ts` L141); operations cancel writes `'cancelled'` (`bookings/[id]/route.ts` L154); create/plan insert `'confirmed'`.

---

## 8. `flow-board` read path

File: `src/app/api/operations/flow-board/route.ts`.

| Question | Answer | Evidence |
| -------- | ------ | -------- |
| Date filter | `Bookings.BookingDate = @bdate` for requested day | L137–154 |
| Head vs detail date | **Head only** (`Bookings.BookingDate`); services loaded separately by `BookingID` | L136–154, L238–253 |
| Business-day range | Also loads **next calendar day** bookings/queue for overnight display | L119–120, L179–197, L361–362 |
| Join duplication | Booking list query has no join to services; services batched → map; **one timeline item per BookingID** | L376–440 |
| Dedup | Group by `AssignedEmpID` in memory; no explicit BookingID dedup across day+nextDay arrays (IDs differ by row) | L287–303 |
| Calendar merge | None | — |
| Frontend ID | `timeline[].sourceId = b.BookingID` | L424–426 |
| Overnight merge date bug | When `b.BookingDate` is a **Date object** (typical mssql), code uses board `dateStr` instead of stored booking date | L389–391 |

```ts
// flow-board/route.ts L389-391
const bookingDateStr = b.BookingDate
  ? (typeof b.BookingDate === 'string' ? b.BookingDate.split('T')[0] : dateStr)
  : dateStr;
```

`normalizeBookingTimes` / `sqlDateToYyyyMmDd` **do** handle `Date` correctly elsewhere (`bookingDateTime.ts` L57–80). Flow-board bypasses that for the date argument by substituting the board date.

Effect when overnight barber loads today+tomorrow bookings: a tomorrow-stored booking can be normalized onto **today’s** `dateStr` and still satisfy `inShiftWindow`, then appear again when the board date is tomorrow. Matches symptom “booking shows under today and tomorrow” as a **Confirmed-from-code display path**, pending Phase 2 reproduction with real driver types.

---

## 9. Confirmed architectural risks

```text
Finding:
  Customer FE advances date for dayOffset=1 and still sends dayOffset=1; /plan applies dayOffset again.
Evidence:
  cut-salon-rtl-booking BookingModal.tsx L445-492; plan/route.ts L192-194, L199; validateBookingSlot dayOffset L755.
Affected flows:
  Customer website → POST /plan (overnight / dayOffset slots).
Possible symptom:
  Wrong BookingDate (shifted +1 day); availability check vs storage mismatch.
Confidence:
  Confirmed from code
```

```text
Finding:
  flow-board substitutes board dateStr when BookingDate is not a string, then merges next-day bookings for overnight shifts.
Evidence:
  flow-board/route.ts L179-197, L361-362, L389-401.
Affected flows:
  GET /api/operations/flow-board overnight barbers.
Possible symptom:
  Same booking appears on today and tomorrow timelines.
Confidence:
  Confirmed from code (display path); Needs Phase 2 verification for live mssql Date typing incidence
```

```text
Finding:
  /create and /plan use different write-time conflict guards; /plan does not call assertEmployeeIntervalAvailable and locks only same-calendar-date Bookings rows (no queue/blocks/app-lock shared with /create).
Evidence:
  create/route.ts L255-266; plan/route.ts L591-607; scheduleIntegrity.ts L248-317 (applock); getEmployeeBusyIntervals also used by create/reschedule.
Affected flows:
  Concurrent Operations /create vs customer /plan (same barber/time).
Possible symptom:
  Two overlapping bookings for same barber.
Confidence:
  Strong architectural risk
```

```text
Finding:
  getEmployeeBusyIntervals always reads bookings/queue via getPool(), not the open SERIALIZABLE transaction connection (transaction used for applock/schedule only).
Evidence:
  scheduleIntegrity.ts L107-128, L261-301; buildBookingIntervals uses pool connection (queueEstimateEngine.ts L462-494).
Affected flows:
  /create write guard; reschedule write guard.
Possible symptom:
  Race window between lock acquisition and insert/update under concurrent writers that do not share the same applock (/plan).
Confidence:
  Strong architectural risk
```

```text
Finding:
  /plan commits one Booking row per service; /create commits one Booking with multiple BookingServices — different occupancy cardinality for the same customer cart.
Evidence:
  plan/route.ts L75-76, L575-701; create/route.ts L308-345; buildSequentialServicePlan usage in create.
Affected flows:
  Multi-service public booking vs operations booking.
Possible symptom:
  Overlap/UI duplication semantics differ across clients; conflict engines see N intervals vs 1.
Confidence:
  Confirmed from code
```

```text
Finding:
  Neither create nor plan implements idempotency keys; FE only disables button while in-flight.
Evidence:
  useBookingWorkspace L371-407; BookingModal L455/L513; no Idempotency-Key / clientRequestId in routes.
Affected flows:
  Both create paths on retry after ambiguous network failure.
Possible symptom:
  Duplicate bookings.
Confidence:
  Strong architectural risk
```

---

## 10. Items requiring Phase 2

1. Reproduce concurrent `/create` + `/plan` on same barber/slot; capture resulting `Bookings` rows.
2. Confirm mssql driver type of `BookingDate` in flow-board responses and reproduce dual-day display on overnight barber.
3. End-to-end customer overnight slot: log payload `date`/`dayOffset` vs inserted `BookingDate`.
4. Verify whether `/plan` UPDLOCK + string time comparison misses queue conflicts and cross-midnight overlaps that `assertEmployeeIntervalAvailable` would catch.
5. Status casing audit (`Cancelled` vs `cancelled`) against all readers (`LOWER` vs exact IN lists).
6. Decide single mutation service ownership (`create` vs `plan`) and row model (1 booking vs N).
7. Confirm absence of calendar sync writers in DB jobs outside this repo (SQL Agent / other services).

---

## Comparison classification (summary)

| Question | Answer |
| -------- | ------ |
| Same mutation service? | **No** — **B**: shared availability helpers, separate mutation implementations |
| `/create` rechecks conflicts in a transaction? | **Yes** — `assertEmployeeIntervalAvailable` inside SERIALIZABLE before insert |
| Reschedule rechecks independently? | **Yes** — `validateBookingMove` then again `assertEmployeeIntervalAvailable` in TRAN |
| Storage date/time columns | `Bookings.BookingDate`, `StartTime`, `EndTime` (+ service durations in `BookingServices`) |

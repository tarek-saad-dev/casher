# Availability Architecture — Phase 2 Context Pack

**Generated:** 2026-08-03  
**Purpose:** Enough context for another developer to implement Phase 2 **without** live repository access.  
**Companion archive:** `availability-phase-2-context-pack.zip` (full source/test files listed in §2).  
**Inspection constraint:** No production code was modified while producing this pack.

**Prior phase:** [`docs/availability-phase-0-1-implementation.md`](./availability-phase-0-1-implementation.md)

**Recommended Phase 2 themes (from Phase 0+1 report):**

1. Migrate `bookings/new` → canonical `createPublicBooking`; then default-disable `LEGACY_BOOKINGS_CREATE_ENABLED`.
2. Migrate singular day-status + estimate/timeline/reschedule **pre-checks** fully onto `resolveEmployeeDayPlan`.
3. Batch-optimize `resolveEmployeeDayPlansBatch` (eliminate N parallel day-plan queries).
4. Enrich empty-slot `employeeReasons` from day-plan deny codes (not only rejected slot plans).
5. **Do not** (in early Phase 2 unless separately scoped): centralized workforce UI, `TblEmpDailyAdjustment`, schema consolidation, booking holds.

---

## 1. Executive summary

Phase 0+1 left the system with:

- **Canonical write path:** `POST /api/public/booking/create` → `createPublicBooking` → SERIALIZABLE TX → `assertEmployeeIntervalAvailable` → `resolveEmployeeDayPlan`.
- **Legacy create path:** `POST /api/bookings` still used by `src/app/bookings/new/page.tsx`, fenced by `LEGACY_BOOKINGS_CREATE_ENABLED` (default **on**), logged, not redirected.
- **Canonical read path (partial):** shared `loadWorkingWindowsBatch` + `resolveEmployeeDayPlan`; flow-board batch status is branch-aware; integrity write guard uses day plan.
- **Remaining divergence:** singular `getBarberDayStatus` still reads **`TblEmpWorkSchedule` only**; queue timeline / estimate / reschedule **pre-checks** use `getBarberWorkingWindow` (weekly base, no overrides) and sometimes local `applyOverrides`; `resolveEmployeeDayPlansBatch` has **zero production callers**; empty-slot reason codes are best-effort from slot rejections, not day-plan denies.

Phase 2 should close create migration + reader parity + batching + richer reason codes **without** schema redesign.

**Baseline tests (this inspection, before any Phase 2 code):**

| Suite set | Result |
|-----------|--------|
| Core Phase 0/1 + booking create/move/duration (6 files) | **76/76 passed** |
| Related schedule suites (5 files) | **3 files failed / 2 passed** — failures are **pre-existing** string-contract / `server-only` issues, not caused by this inspection |

---

## 2. File inventory

### Environment / tooling

| Item | Value |
|------|--------|
| App | Next.js **16.2.1** (App Router under `src/app/`), React **19.2.4**, TypeScript **5** |
| DB | `mssql` **^12.2.1**, `@types/mssql` **^9.1.9**; `getPool()` / `sql` from `src/lib/db.ts`; TX: `new sql.Transaction(db)` + `sql.ISOLATION_LEVEL.SERIALIZABLE` |
| Tests | Vitest **^4.1.9**; `npm test` → `vitest run`; watch: `npm run test:watch` |
| Dev server | `npm run dev:app` → `next dev --port 5500` |
| Routing | App Router: `src/app/**/page.tsx`, `src/app/api/**/route.ts` |

### Relevant dependencies (`package.json`)

**Runtime (availability/booking-relevant):** `next`, `react`, `react-dom`, `mssql`, `server-only`, `date-fns`, `decimal.js`

**Dev:** `vitest`, `typescript`, `eslint`, `eslint-config-next`, `@types/mssql`, `@types/node`, `@types/react`, happy-dom, testing-library

### Feature / env flags (names only — no secrets)

| Flag | Default / behavior |
|------|--------------------|
| `LEGACY_BOOKINGS_CREATE_ENABLED` | Default **enabled**; `false`/`0`/`off`/`no` → HTTP 410 on legacy POST create |
| `AVAILABILITY_PARITY_DIAG` | `1`/`true` forces day-plan parity mismatch logs; else development-only on mismatch |
| `NODE_ENV` | Affects parity diag sampling |
| `DEBUG_BOOKING_MOVE` | Reschedule debug (`bookingRescheduleCore`) |
| `SESSION_SECRET` | Session auth (do not ship values) |
| DB vars | `CLOUD_DB_*` / `LOCAL_DB_*` / `DB_*` — connection only; never include values |

### ZIP contents (full sources)

Archive root mirrors repo paths for:

- All Phase 1 availability modules under `src/lib/availability/`
- Create/read paths listed in §§3–5
- `scheduleIntegrity`, `availabilityEngine`, `barberAvailability`, `bookingAvailabilityEngine`, reschedule/timeline/estimate cores
- Listed `__tests__` files + `package.json` + Phase 0+1 + this doc

**Excluded from ZIP:** `node_modules`, `.next`, build outputs, `.env*`, credentials, dumps, unrelated app/UI trees.

---

## 3. Relevant code blocks (contracts + critical paths)

> **Full file bodies** for every path below are in the ZIP. This section embeds complete small modules and the exact contracts/signatures implementers must preserve.

### 3.1 Reason codes — complete file

Path: `src/lib/availability/reasonCodes.ts`

```ts
export const AVAILABILITY_REASON_CODES = [
  'BRANCH_CLOSED',
  'EMPLOYEE_INACTIVE',
  'NOT_ASSIGNED_TO_BRANCH',
  'SCHEDULE_NOT_CONFIGURED',
  'EMPLOYEE_OFF_DAY',
  'EMPLOYEE_ABSENT',
  'FREELANCER_NOT_PLANNED',
  'SERVICE_NOT_SUPPORTED',
  'OUTSIDE_WORKING_WINDOW',
  'BLOCKED_BY_BREAK',
  'BLOCKED_BY_OVERRIDE',
  'BOOKING_CONFLICT',
  'QUEUE_CONFLICT',
  'NO_CONTIGUOUS_WINDOW',
  'NO_EMPLOYEE_AVAILABLE',
  'MIN_NOTICE_NOT_MET',
  'MAX_ADVANCE_EXCEEDED',
  'SLOT_UNAVAILABLE',
] as const;

export type AvailabilityReasonCode = (typeof AVAILABILITY_REASON_CODES)[number];

export type EmployeeAvailabilityReason = {
  empId: number;
  reasonCode: AvailabilityReasonCode;
  message?: string;
};

export function mapLegacySlotReason(legacy?: string | null): AvailabilityReasonCode | undefined;
export function inferDayDenyReason(input: {
  contextsEmpty: boolean;
  specificEmp?: boolean;
  dayOff?: boolean;
  absent?: boolean;
  notWorking?: boolean;
  scheduleMissing?: boolean;
}): AvailabilityReasonCode;
```

(`mapLegacySlotReason` / `inferDayDenyReason` bodies are in ZIP — identical to Phase 1.)

### 3.2 Legacy fence — complete contract

Path: `src/lib/availability/legacyBookingCreateFence.ts`

- `isLegacyBookingsCreateEnabled()` — default true
- `isCanonicalCreateEligibleShape({ empId, bookingDate, startTime, services })` — requires `YYYY-MM-DD`, time ≥4 chars, at least one `services[].proId`
- `logLegacyBookingCreate(payload)` — JSON under `[legacy-booking-create]`, no customer PII
- Disabled body: `{ success: false, code: 'LEGACY_BOOKING_CREATE_DISABLED', message, messageAr }`

### 3.3 Canonical day plan — types + signatures

Path: `src/lib/availability/resolveEmployeeDayPlan.ts` (**335 lines — full in ZIP**)

```ts
export type DayPlanWindow = {
  start: string;
  end: string;
  endDayOffset: 0 | 1;
  startMs: number;
  endMs: number;
};

export type EmployeeDayPlan = {
  employeeId: number;
  branchId: number | null;
  businessDate: string;
  isWorking: boolean;
  effectiveWindows: DayPlanWindow[];
  baseScheduleSource:
    | 'BRANCH_WEEKLY'
    | 'LEGACY_WEEKLY'
    | 'TEMPORARY_TRANSFER'
    | 'FREELANCE_UNLOCK'
    | 'NONE';
  weeklyWindows: WorkingWindowRow | null;
  appliedOverrides: ScheduleOverride[];
  attendanceState: DayPlanAttendanceState | null;
  denyReasonCode: AvailabilityReasonCode | null;
  warnings: string[];
  effSched: EffectiveSchedule | null;
  isOvernight: boolean;
};

export async function resolveEmployeeDayPlan(args: {
  branchId?: number | null;
  empId: number;
  businessDate: string;
  source?: 'public' | 'operations' | 'admin';
  transaction?: Transaction; // mssql Transaction — cast to pool request API for reads
}): Promise<EmployeeDayPlan>;

/** Currently N× parallel resolveEmployeeDayPlan — no shared batch queries yet. */
export async function resolveEmployeeDayPlansBatch(args: {
  branchId?: number | null;
  empIds: number[];
  businessDate: string;
  source?: 'public' | 'operations' | 'admin';
}): Promise<Map<number, EmployeeDayPlan>>;
```

**Internal pipeline (must preserve):**

1. `loadWorkingWindowsBatch(db, [empId], dow, { branchId, workDate })`
2. `loadBookingOverridesForDate(db, [empId], businessDate)`
3. `loadFreelanceBookingUnlocks([empId], businessDate)`
4. Attendance row + DayOff + Absent flags
5. Freelance unlock if weekly off
6. `applyOverrides(empId, businessDate, base, overrides)`
7. Overnight: `hhmm(end) <= hhmm(start)` → `endMs` on next calendar day via `salonDateTimeToMs`

### 3.4 Weekly window loader — return type

Path: `src/lib/availability/loadWorkingWindowsBatch.ts` (**163 lines — full in ZIP**)

```ts
export type WorkingWindowRow = {
  startTime: string | null;
  endTime: string | null;
  isWorkingDay: boolean;
  source?: 'BRANCH_WEEKLY' | 'LEGACY_WEEKLY' | 'TEMPORARY_TRANSFER';
};

export async function loadWorkingWindowsBatch(
  db: Awaited<ReturnType<typeof getPool>>,
  empIds: number[],
  dayOfWeek: number,
  opts?: { branchId?: number; workDate?: string },
): Promise<Map<number, WorkingWindowRow>>;
```

**Behavior:**

- With `branchId` + `workDate`: `TblEmpBranchWorkSchedule` (latest effective) → transfer-in → transfer-away → legacy fill for missing.
- Without `branchId` but with `workDate`: branch schedule via `TblEmpBranchAssignment` join → legacy fill.
- EmpIDs interpolated into `IN (...)` lists (existing pattern).

### 3.5 `scheduleIntegrity` — write guard contracts

Path: `src/lib/scheduleIntegrity.ts` (**427 lines — full in ZIP**)

```ts
export interface EmployeeShiftBounds {
  shiftStartMs: number;
  shiftEndMs: number;
  effSched: EffectiveSchedule;
  isWorking: boolean;
}

export async function getEmployeeEffectiveSchedule(args: {
  empId: number;
  operationalDate: string;
  branchId?: number | null;
  transaction?: Transaction;
  settings?: Awaited<ReturnType<typeof getGlobalTimingDefaults>>;
}): Promise<EmployeeShiftBounds | null>;
// Implementation: resolveEmployeeDayPlan → map windows/effSched

export async function assertEmployeeIntervalAvailable(args: {
  empId: number;
  startAt: Date;
  endAt: Date;
  now?: Date;
  operationalDate?: string; // default getCairoBusinessDate(now)
  branchId?: number | null;
  excludeQueueTicketId?: number;
  excludeBookingId?: number;
  transaction?: Transaction;
}): Promise<void>; // throws ScheduleConflictError
```

`ScheduleConflictError`: `status=409`, `code='SCHEDULE_CONFLICT'`, `conflict: { type: 'booking'|'queue'|'block', id, empId?, startAt, endAt, reference? }`.

### 3.6 Canonical create route — complete file

Path: `src/app/api/public/booking/create/route.ts` (**115 lines**)

See ZIP. Critical mapping:

| Body / auth | Maps to `createPublicBooking` |
|-------------|-------------------------------|
| `source: operations\|admin` | `requireBranchOperationAccess()`; session `branchCode`; `purpose='internal_preview'`; `bookingSource` |
| else | public `branchCode` from query/body; `bookingSource='online'` |
| `customer`, `date`, `time`, `dayOffset`, `serviceIds`, `empId`, `mode`, `planToken`, notes, idempotency | as typed |
| Ignored | `BranchID`, `price`, `duration*`, `total`, `status`, `bookingCode`, `endTime`, `timezone` |

Success: HTTP **201**, `result.body` (`ok: true`, `booking`, `meta`, `message`).  
Errors: `PublicBookingCreateError` / `PublicBookingSelectionError` → catalog via `finalizePublicBookingError`.

### 3.7 `PublicBookingCreateInput` / result

Path: `src/lib/booking/publicBookingCreate.ts` (**885 lines — full in ZIP**)

```ts
export type PublicBookingCreateInput = {
  branchCode?: string | null;
  date?: string | null;
  time?: string | null;
  dayOffset?: unknown;
  serviceIds?: unknown;
  empId?: unknown;
  mode?: unknown;
  planToken?: string | null;
  customer?: { name?: string; phone?: string | null } | null;
  notes?: string | null;
  clientRequestId?: string | null;
  idempotencyKeyHeader?: string | null;
  previewQueryParam?: string | null;
  suppressNotification?: boolean;
  auth?: { userId: number; canOperate?: boolean } | null;
  purpose?: 'public_booking' | 'internal_preview';
  bookingSource?: 'online' | 'operations' | 'admin';
};

export type PublicBookingCreateResult = {
  httpStatus: 201;
  body: {
    ok: true;
    booking: Record<string, unknown>;
    meta: {
      idempotentReplay: boolean;
      planTokenStatus: PlanTokenStatus;
      createdAt: string;
      assignmentStrategy: string;
    };
    message: string;
    whatsapp?: { scheduled: boolean; skipped: boolean; reason: string };
    compatibility?: ContractCompatibilityFlags;
  };
};
```

Write guard (inside SERIALIZABLE TX) passes **`branchId: branchNow.branchId`**.

Persisted booking: `Status='confirmed'`, `Source=bookingSource`, server-priced services, qty=1.

### 3.8 Legacy create — request/response

Path: `src/app/api/bookings/route.ts` POST

**Request:** `{ clientId, empId, bookingDate, startTime, endTime, source='phone', notes, services=[{proId,empId,qty,price,durationMinutes,notes}] }`

**Responses:**

| HTTP | Body |
|------|------|
| 410 | fence disabled body |
| 400 | `{ error }` missing date/time |
| 409 | eligibility / availability / double-book |
| 201 | `{ bookingId }` — Status **`pending`** |
| 500 | `{ error }` |

Branch from `requireActiveBranchContext()` — never client.

### 3.9 Admin UI create caller

Path: `src/app/bookings/new/page.tsx`

```ts
await fetch('/api/bookings', {
  method: 'POST',
  body: JSON.stringify({
    clientId, empId, bookingDate, startTime, endTime,
    source, // phone|whatsapp|website|admin|walk_in
    notes,
    services: [{ proId, empId, qty, price, durationMinutes }],
  }),
});
// success → data.bookingId
```

Also GET `/api/bookings?date=&empId=` for conflict display.

### 3.10 Ops workspace create caller

Path: `src/components/operations/booking-workspace/useBookingWorkspace.ts`

```ts
await fetch('/api/public/booking/create', {
  method: 'POST',
  body: JSON.stringify({
    customer: { name, phone },
    serviceIds,
    date: bookingDate,
    time: selectedSlot.time,
    dayOffset: selectedSlot.dayOffset ?? 0,
    mode: mode === 'specific' ? 'specific' : 'nearest',
    empId: selectedSlot.empId,
    notes,
    source: 'operations',
  }),
});
```

### 3.11 Singular day status (legacy weekly) — still divergent

Path: `src/lib/availabilityEngine.ts`

- `getDefaultSchedule(empId, dateStr)` → **`TblEmpWorkSchedule` ONLY** (lines ~208–279).
- `getBarberDayStatus(empId, dateStr, opts?)` uses that + day-off + overrides + attendance + freelance + local `applyOverrides`.
- `getBarbersDayStatus(empIds, dateStr, { isToday?, branchId? })` uses **`loadWorkingWindowsBatch`** (Phase 1) — branch-aware.
- `checkBarberAvailableAt(...)` wraps singular status — **no production callers found** outside definition.

### 3.12 Remaining `getBarberWorkingWindow` pre-checks

```ts
// queueEstimateEngine.hasAnyAvailableSlotForBarberOnDay
const window = await getBarberWorkingWindow(empId, dateObj); // no branchId, no overrides

// operationsQueueTimeline.buildBarberOperationalTimeline
const window = await getBarberWorkingWindow(empId, dateObj);

// bookingRescheduleCore.getBarberShiftBounds (private)
const baseWindow = await getBarberWorkingWindow(empId, dateObj);
const overridesMap = await loadBookingOverridesForDate(...);
const effSched = applyOverrides(...); // local — duplicates day plan
```

`getBarberWorkingWindow` itself now delegates to `loadWorkingWindowsBatch` (+ freelance) but **still returns weekly base only**.

---

## 4. Call graph

```text
[Admin UI] bookings/new
  └─ POST /api/bookings  (LEGACY — fence + non-TX insert, Status=pending)
       ├─ requireActiveBranchContext
       ├─ isEmployeeEligibleForBranchBookings
       └─ checkBarberAvailableForBooking (queueEstimateEngine)

[Ops UI] useBookingWorkspace
  └─ POST /api/public/booking/create  (CANONICAL)
       └─ createPublicBooking
            ├─ evaluatePublicBookingSelection (slots/precheck)
            ├─ SERIALIZABLE Transaction
            ├─ assertEmployeeIntervalAvailable(+branchId)
            │    └─ getEmployeeEffectiveSchedule
            │         └─ resolveEmployeeDayPlan
            │              ├─ loadWorkingWindowsBatch
            │              ├─ loadBookingOverridesForDate → applyOverrides
            │              └─ freelance / day-off / absent
            └─ INSERT Bookings(+services) Status=confirmed

[Public] same create route without ops auth

[Queue create] operationsQueueCreateCore
  └─ assertEmployeeIntervalAvailable(+branchId)  [canonical]

[Reschedule write] rescheduleBookingMove
  └─ assertEmployeeIntervalAvailable(no branchId yet)  [canonical windows]
[Reschedule precheck] validateBookingMove
  └─ getBarberShiftBounds → getBarberWorkingWindow + local overrides  [DIVERGENT]

[Flow board] loadFlowBoardForBranch
  └─ getBarbersDayStatus(+branchId) → loadWorkingWindowsBatch + local applyOverrides

[Slots] listAvailableBookingSlots
  └─ loadWorkingWindowsBatch(+branchId) + overrides + occupancy
       └─ empty → reasonCode / employeeReasons (from slot plans, not day-plan)
```

---

## 5. Request and response contracts

### Legacy vs canonical create (migration table)

| Concern | Legacy `POST /api/bookings` | Canonical `POST /api/public/booking/create` |
|---------|----------------------------|-----------------------------------------------|
| Branch | Session only | Session (ops/admin) or `branchCode` (public) |
| Customer | `clientId` | `customer: { name, phone }` (+ upsert) |
| Employee | `empId` | `empId` + `mode` (`nearest`/`specific`/`any_barber`) |
| When | `bookingDate` + `startTime` + optional `endTime` | `date` + `time` + `dayOffset` (server end) |
| Services | `services[].proId` + client price/duration | `serviceIds[]` — **server** price/duration |
| Source | phone/whatsapp/website/admin/walk_in | online / operations / admin |
| Success | `{ bookingId }` Status **pending** | `{ ok, booking: { code, ... } }` Status **confirmed** |
| Guard | Soft checks, non-TX insert | SERIALIZABLE + applock + day plan |
| Disable | 410 fence | N/A |

### Available slots envelope (additive Phase 1C)

```ts
// listAvailableBookingSlots result
{
  ok: true,
  date, mode, empId?,
  slots, availableSlots,
  noSlotsReason: string | null,           // Arabic — keep
  reasonCode?: AvailabilityReasonCode | null,
  employeeReasons?: EmployeeAvailabilityReason[],
  gapNotice, nextAvailable, alternativeBarbers, debug
}

// Per-slot legacy codes (unchanged)
BookingSlotReasonCode =
  | 'insufficient_continuous_time' | 'booking_conflict' | 'queue_conflict'
  | 'break' | 'outside_working_hours' | 'minimum_notice'
  | 'barber_unavailable' | 'past'
```

Public empty slots also expose `reasonCode` / `message` / `employeeReasons` (`publicBookingAvailability.ts`).

Ops/admin available-slots route forwards `reasonCode` + `employeeReasons`.

---

## 6. Database query flow

### Tables / columns (no schema changes proposed)

| Table | Relevant columns | Used by |
|-------|------------------|---------|
| `TblEmpBranchWorkSchedule` | EmpID, BranchID, DayOfWeek, IsWorking, StartTime, EndTime, IsActive, EffectiveFrom/To, ScheduleID | loadWorkingWindowsBatch |
| `TblEmpBranchAssignment` | EmpID, BranchID, IsActive, EffectiveFrom/To | loader when branchId omitted |
| `TblEmpTemporaryBranchTransfer` | EmpID, From/ToBranchID, WorkDate, StartTime, EndTime, IsActive | loader |
| `TblEmpWorkSchedule` | EmpID, DayOfWeek, IsWorkingDay, StartTime, EndTime | legacy fill; **singular getDefaultSchedule only** |
| `TblEmpScheduleOverrides` | OverrideID, EmpID, OverrideDate, Type, Start/EndTime, Reason, IsActive, CreatedBy | loadBookingOverridesForDate |
| `TblEmpAttendance` | EmpID, WorkDate, Status, CheckIn/Out, ScheduledStart/End | day plan, overrides expand, freelance |
| `TblEmpDayOff` | EmpID, OffDate, OffType, Reason, IsDeleted | day plan / day status |
| `TblEmp` | EmpID, EmpName, Job, isActive | names, freelance unlock |
| `Bookings` / `BookingServices` / queue tickets | occupancy | engine + integrity busy intervals |

### Query-flow table — `resolveEmployeeDayPlan` (one employee)

| Step | Query/table | Per batch or per employee | Transaction-aware | Can be shared |
|------|-------------|---------------------------|-------------------|---------------|
| 1 | Branch weekly / transfer / legacy (`loadWorkingWindowsBatch`) | **Batch-capable** (API already takes empIds[]) | Uses `db` from TX or pool | Yes — once per (branchId, date, empIds) |
| 2 | `loadBookingOverridesForDate` | Batch-capable | Yes | Yes |
| 3 | `loadFreelanceBookingUnlocks` | Batch-capable | Pool (typical) | Yes |
| 4 | Attendance state SELECT | **Per employee** today | Yes | Can batch |
| 5 | DayOff SELECT | Per employee today | Yes | Can batch |
| 6 | Absent SELECT | Per employee today | Yes | Can batch (or fold into 4) |
| 7 | `getGlobalTimingDefaults` | Global | N/A | Yes — once |

### `resolveEmployeeDayPlansBatch` today

| Step | Behavior |
|------|----------|
| Implementation | `Promise.all(empIds.map(id => resolveEmployeeDayPlan(...)))` |
| N+1 | **Yes** — repeats steps 1–7 per employee (even though step 1 API is batchable) |
| Phase 2 fix | One shared `loadWorkingWindowsBatch` + one overrides map + one freelance map + one attendance/day-off batch; then pure per-emp `applyOverrides` |

### Singular `getBarberDayStatus` queries (divergent)

| Step | Query | Notes |
|------|-------|-------|
| Weekly | `TblEmpWorkSchedule` only via `getDefaultSchedule` | **Ignores branch table** |
| DayOff / Overrides / Attendance / Freelance | Separate | Local `applyOverrides` |

---

## 7. Legacy create caller audit

Search corpus: `POST /api/bookings`, `/api/bookings`, `/api/public/booking/create`, `createPublicBooking`.

| Location | Classification |
|----------|----------------|
| `src/app/bookings/new/page.tsx` `fetch('/api/bookings', { method:'POST' })` | **Create caller** (legacy) — migrate |
| `src/app/api/bookings/route.ts` POST | Legacy create handler |
| `src/components/operations/booking-workspace/useBookingWorkspace.ts` → `/api/public/booking/create` | **Create caller** (canonical) |
| `src/app/api/public/booking/create/route.ts` | Canonical create handler |
| `src/lib/booking/publicBookingCreate.ts` `createPublicBooking` | Canonical service |
| `src/app/bookings/page.tsx` GET/PATCH | GET/list + update/cancel |
| `src/app/bookings/[id]/page.tsx` GET/PATCH/convert | Update/cancel/convert |
| `src/app/bookings/calendar/page.tsx` GET | GET/list |
| `src/components/operations/SchedulerBoard.tsx` PATCH | Update |
| `src/components/operations/BookingDetailsModal.tsx` GET | GET |
| `src/components/operations/MoreTimelineItemsModal.tsx` GET | GET |
| `src/app/api/bookings/[id]/route.ts` | GET/PATCH |
| `src/app/api/bookings/[id]/convert/route.ts` | Convert |
| `src/app/api/bookings/estimate/route.ts` | Estimate (not create) |
| `__tests__/*` referencing create / fence / CORS / contracts | **Test** |
| `helpers/phase6cSmokeHarness.ts` | Test harness calling `createPublicBooking` |
| Fence comments / docs | Documentation |

**Unknown external callers:** measurable via `[legacy-booking-create]` logs + `canonicalCreateEligible`.

---

## 8. Availability reader audit

| Symbol | File / export | Inputs | Schedule source | branchId? | Local overrides? | TX | Caller contract | Recommended replacement |
|--------|---------------|--------|-----------------|-----------|------------------|----|-----------------|-------------------------|
| `resolveEmployeeDayPlan` | `resolveEmployeeDayPlan.ts` | empId, businessDate, branchId?, TX? | Shared loader + overrides + freelance | Optional | Via applyOverrides | Optional | `EmployeeDayPlan` | **Canonical** |
| `resolveEmployeeDayPlansBatch` | same | empIds[] | Same (N×) | Optional | Yes | No | `Map<empId, plan>` | Optimize + wire flow-board |
| `getEmployeeEffectiveSchedule` | `scheduleIntegrity.ts` | empId, date, branchId? | Day plan | Optional | In day plan | Optional | `EmployeeShiftBounds` | Keep |
| `assertEmployeeIntervalAvailable` | same | interval + optional branchId | Day plan | Optional | No | Prefer inside | throws `ScheduleConflictError` | Pass branchId from reschedule |
| `getBarberWorkingWindow` | `barberAvailability.ts` | empId, Date, branchId? | Shared loader + freelance; **no overrides** | Optional (often unused) | No | No | `{ startTime, endTime, isWorkingDay }` | Prefer day plan for effective hours |
| `getBarberDayStatus` | `availabilityEngine.ts` | empId, dateStr | **`TblEmpWorkSchedule` only** | No | Yes | No | `BarberDayStatus` | Day plan + UI mapping |
| `getBarbersDayStatus` | same | empIds, date, branchId? | Shared loader | Yes when passed | Yes | No | `Map` statuses | Later: day-plans batch |
| `checkBarberAvailableAt` | same | empId, start/end Date | Singular status | No | Via singular | No | `{ available, reason, statusReasonArabic }` | Dead; if revived → day plan / assert |
| `hasAnyAvailableSlotForBarberOnDay` | `queueEstimateEngine.ts` | empId, dateStr, services… | `getBarberWorkingWindow` | No | No | No | `DayAvailabilityResult` | Day plan windows |
| `buildBarberOperationalTimeline` | `operationsQueueTimeline.ts` | empId, date, now | `getBarberWorkingWindow` | No | No | No | timeline + workStart/End | Day plan |
| `getBarberShiftBounds` | `bookingRescheduleCore.ts` (private) | empId, date | Working window + **local** overrides | No | Yes | Before TX | shift ms | `getEmployeeEffectiveSchedule` |
| `validateBookingMove` | same | move args | Above + evaluateBookingSlotAt | No | Yes (dup) | Before TX | `BookingMoveValidationResult` | Single day-plan / integrity schedule |
| `rescheduleBookingMove` | same | move + TX | assert (day plan) | **Not passed** | No | Inside | commit / conflict | Add branchId |

**Production callers of `resolveEmployeeDayPlansBatch`:** none (mock only).

---

## 9. Reason-code flow

```text
evaluateBarberSlot
  └─ BookingSlotReasonCode on each plan (legacy snake_case)

listAvailableBookingSlots (availableSlots.length === 0)
  ├─ contexts.length === 0
  │    └─ inferDayDenyReason({ contextsEmpty })
  │    └─ employeeReasons: [{ empId, EMPLOYEE_OFF_DAY }] if specific
  ├─ specific emp with contexts
  │    └─ samplePlan.reasonCode → mapLegacySlotReason → reasonCode
  │    └─ employeeReasons: [{ empId, reasonCode, message }]
  └─ nearest / multi
       └─ first rejection per emp from allPlans → employeeReasons
       └─ reasonCode = single distinct OR NO_EMPLOYEE_AVAILABLE

publicBookingAvailability.getPublicAvailableSlots
  └─ if slots empty: reasonCode, message=noSlotsReason, employeeReasons

available-slots route (ops/admin)
  └─ forwards reasonCode + employeeReasons
```

**Gap for Phase 2:** when contexts are empty, engine does **not** call `resolveEmployeeDayPlan` per emp to distinguish `SCHEDULE_NOT_CONFIGURED` vs `EMPLOYEE_ABSENT` vs `EMPLOYEE_OFF_DAY`. Add day-plan lookup (batched) before collapsing to generic Arabic messages.

---

## 10. Test inventory and results

### Commands executed (inspection)

```text
npx vitest run src/lib/__tests__/availabilityPhase01.test.ts src/lib/__tests__/bookingOperationalDate.test.ts src/lib/__tests__/bookingAvailabilityEngine.test.ts src/lib/__tests__/bookingCreateCanonicalContract.test.ts src/lib/__tests__/bookingMoveValidation.test.ts src/lib/__tests__/bookingAvailabilityDuration.test.ts --reporter=verbose
```

**Result:** 6 files, **76 tests passed**, 0 failed. Duration ~7s.

```text
npx vitest run src/lib/__tests__/bookingReschedule.test.ts src/lib/__tests__/phase1qEmployeeBranchSchedule.test.ts src/lib/__tests__/phase1rEmployeeScheduleOperations.test.ts src/lib/__tests__/attendance-shift-schedule-sync.test.ts src/lib/__tests__/phase1oCampCaesarOvernightHours.test.ts --reporter=dot
```

**Result:** 2 passed / 3 failed files; **41 passed / 4 failed tests**.

### Pre-existing failures (not introduced by this inspection; **no code fixed**)

1. **`bookingReschedule.test.ts`** — suite load fails: `server-only` cannot be imported from Client Component path (import graph).  
2. **`phase1qEmployeeBranchSchedule.test.ts`** — expects create route source to contain string `BARBER_AVAILABLE_AT_DIFFERENT_BRANCH` (stale string contract; logic lives deeper).  
3. **`phase1rEmployeeScheduleOperations.test.ts`** — expects flow-board route to contain `listOperationalPresenceForBranch` / `isEmergencyTransfer` (logic moved into `loadFlowBoardForBranch`); expects create route to contain `BARBER_AVAILABLE_AT_DIFFERENT_BRANCH`.

`attendance-shift-schedule-sync` and overnight Camp/Caesar suites in that run: **passed**.

### Tests included in ZIP / required reading

| File | Covers |
|------|--------|
| `availabilityPhase01.test.ts` | Fence, reason codes, wiring contracts, override math, business date |
| `bookingOperationalDate.test.ts` | Cairo 03:59/04:00, overnight UI formatting |
| `bookingAvailabilityEngine.test.ts` | Slot evaluate conflicts / min notice / gaps |
| `bookingCreateCanonicalContract.test.ts` | createPublicBooking contracts (source-read) |
| `bookingMoveValidation.test.ts` | Reschedule validation + TX guard (mocked) |
| `bookingAvailabilityDuration.test.ts` | Continuous window / overnight duration |

### Related tests (not all in ZIP; locate in repo)

| Area | Files |
|------|-------|
| Reschedule | `bookingReschedule.test.ts` (currently broken under server-only) |
| Branch schedules | `phase1qEmployeeBranchSchedule.test.ts` |
| Ops schedule/transfers | `phase1rEmployeeScheduleOperations.test.ts`, schedule-control tests |
| Overnight | `phase1oCampCaesarOvernightHours.test.ts`, `bookingCreateOvernightEquivalent.test.ts`, `bookingCancellationOvernight.test.ts` |
| Overrides / attendance expand | `attendance-shift-schedule-sync.test.ts` |
| Queue | `queueLifecycleEngine.test.ts`, `persistQueueTicketSource.test.ts` — **no dedicated timeline/estimate unit suite found** |

### Missing Phase 2 test coverage

1. `bookings/new` → canonical create payload mapping (integration or contract).  
2. Legacy fence default-off + 410 from UI path.  
3. `getBarberDayStatus` vs `resolveEmployeeDayPlan` parity (branch schedule / transfer / overnight).  
4. `buildBarberOperationalTimeline` / `hasAnyAvailableSlotForBarberOnDay` after day-plan migration.  
5. Reschedule precheck == `getEmployeeEffectiveSchedule` / assert windows (incl. `excludeBookingId`, branchId).  
6. True batch day-plan: one SQL round-trip set for N emps (assert query count).  
7. Empty slots: day-plan-derived `EMPLOYEE_ABSENT` vs `SCHEDULE_NOT_CONFIGURED` vs `EMPLOYEE_OFF_DAY`.  
8. Temporary transfer into/away branch window parity (live or mocked SQL).  

---

## 11. Phase 2 implementation risks

1. **Status semantic change:** legacy creates `pending`; canonical creates `confirmed` — admin list filters / convert flows may assume pending.  
2. **Customer model:** `clientId` vs name/phone upsert — must preserve existing clients and phone rules for staff (placeholder phone allowed for `internal_preview`).  
3. **Source enum:** admin UI sources (`phone`, …) vs canonical `operations|admin|online` — map carefully or extend `bookingSource`.  
4. **Idempotency / planToken:** public enforce mode; staff path currently skips — do not accidentally require tokens for admin migrate.  
5. **Singular vs batch day status:** schedule-control apply/restore still uses singular legacy weekly — migrating without `branchId` can change displayed hours.  
6. **Reschedule precheck vs write:** fixing only write already done; leaving precheck divergent causes UX false negatives/positives.  
7. **N+1 batch:** naive `resolveEmployeeDayPlansBatch` on large boards can spike DB latency.  
8. **Reason-code clients:** additive fields are safe; changing Arabic `noSlotsReason` text may break screenshot/golden tests.  
9. **Stale string tests** (`BARBER_AVAILABLE_AT_DIFFERENT_BRANCH` in route files) will keep failing until updated — do not treat as Phase 2 product regressions.  
10. **`server-only` in test graph** for reschedule suite — may need vitest mock of `server-only` when touching day-plan imports.

---

## 12. Exact recommended edit plan

### Workstream A — Migrate legacy create (highest product risk)

1. Map `bookings/new` POST body → canonical payload (`customer` from selected client name/mobile, `serviceIds`, `date`/`time`/`dayOffset=0`, `mode=specific`, `empId`, `source='admin'`).  
2. Call `POST /api/public/booking/create` (or shared server action wrapping `createPublicBooking`) with session auth path.  
3. Adapt success UI: `booking.code` (and optional lookup by code) instead of only `bookingId`; confirm status `confirmed` is acceptable for admin list.  
4. Keep GET `/api/bookings` for listing.  
5. Observe `[legacy-booking-create]` traffic; when zero / only tests: set `LEGACY_BOOKINGS_CREATE_ENABLED=false` in prod config (still keep handler + 410).  
6. **Do not** auto-redirect inside legacy POST unless behavior is proven identical (Phase 0 decision).

### Workstream B — Reader migration

1. **`getBarberDayStatus`:** replace `getDefaultSchedule` with `loadWorkingWindowsBatch` / `resolveEmployeeDayPlan`; add optional `branchId`. Update schedule-control callers to pass `auth.activeBranchId`.  
2. **`bookingRescheduleCore.getBarberShiftBounds`:** delete local override apply; call `getEmployeeEffectiveSchedule({ empId, operationalDate, branchId })`. Pass `branchId` into `assertEmployeeIntervalAvailable` on commit.  
3. **`buildBarberOperationalTimeline` / `hasAnyAvailableSlotForBarberOnDay`:** use day-plan `effectiveWindows[0]` (or weekly if product intentionally wants base — prefer effective for ops). Thread `branchId` where available.  
4. Wire **`resolveEmployeeDayPlansBatch`** after implementing true shared loads; optionally feed flow-board mapping.  
5. Leave HR `employeeBranchScheduleResolver` unless it affects booking writes (document-only OK).

### Workstream C — Batching

1. Extract `loadDayPlanInputsBatch({ branchId, empIds, businessDate, db })` returning windowsMap, overridesMap, freelanceMap, attendanceMap, dayOffSet, absentSet.  
2. `resolveEmployeeDayPlan` / batch share that loader.  
3. Add query-count test with mocked `db.request().query`.

### Workstream D — Reason codes

1. When `contexts.length === 0` or specific emp not in contexts: batch `resolveEmployeeDayPlan` for candidate empIds → set `denyReasonCode` into `employeeReasons`.  
2. Prefer specific codes over `NO_EMPLOYEE_AVAILABLE` / generic Arabic.  
3. Keep `noSlotsReason` strings stable unless product asks otherwise.

### Workstream E — Tests / docs

1. New Phase 2 tests from §10 missing list.  
2. Update stale phase1q/phase1r string assertions if touched.  
3. Fix or quarantine `bookingReschedule.test.ts` `server-only` import.  
4. Append `docs/availability-phase-2-implementation.md` when done (not created in this inspection).

### Explicit non-goals for early Phase 2

- Centralized `/admin/workforce/availability` UI  
- `TblEmpDailyAdjustment` / dropping day-off tables  
- Schema migrations  
- Changing payroll `getBusinessDateStr` (5 AM)  
- Deleting legacy POST handler file before traffic is proven zero  

---

## Appendix A — Key absolute paths

```text
c:\Users\user\Desktop\pos-system\src\lib\availability\resolveEmployeeDayPlan.ts
c:\Users\user\Desktop\pos-system\src\lib\availability\loadWorkingWindowsBatch.ts
c:\Users\user\Desktop\pos-system\src\lib\scheduleIntegrity.ts
c:\Users\user\Desktop\pos-system\src\lib\booking\publicBookingCreate.ts
c:\Users\user\Desktop\pos-system\src\app\api\public\booking\create\route.ts
c:\Users\user\Desktop\pos-system\src\app\api\bookings\route.ts
c:\Users\user\Desktop\pos-system\src\app\bookings\new\page.tsx
c:\Users\user\Desktop\pos-system\docs\availability-phase-0-1-implementation.md
c:\Users\user\Desktop\pos-system\docs\availability-phase-2-context-pack.md
c:\Users\user\Desktop\pos-system\availability-phase-2-context-pack.zip
```

## Appendix B — Uncertain / missing

- External (non-repo) callers of legacy POST — only observable via production logs.  
- Whether admin product owners accept `confirmed` vs `pending` for staff-created bookings.  
- Exact mapping of legacy `source` values (`phone`, …) into `Bookings.Source` under canonical path (currently ops uses `operations`/`admin`/`online` only).  
- No dedicated unit tests for `operationsQueueTimeline` / `hasAnyAvailableSlotForBarberOnDay` found.

---

```text
PHASE 2 CONTEXT PACK COMPLETE
NO PRODUCTION CODE MODIFIED
```

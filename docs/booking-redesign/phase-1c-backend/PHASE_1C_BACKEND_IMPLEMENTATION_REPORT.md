# Phase 1C Backend — Multi-Branch Barber Availability

**Date:** 2026-08-06  
**Goal:** Aggregate public availability for a multi-branch barber without duplicating the scheduling engine or changing plan/create.

---

## Existing cross-branch endpoint audit

**Endpoint audited:** `POST /api/public/booking/barbers/[empId]/cross-branch-availability`  
**Implementation:** `src/lib/booking/publicBookingCrossBranchAvailability.ts` (Phase 10C)

| Capability | Supported by Phase 10C? | Notes |
|------------|-------------------------|-------|
| Specific `empId` | Yes | Path param |
| Multiple `serviceIds` | Yes | Max 12 |
| All active public branches assigned to employee | Yes | Assignment ∩ PUBLIC_LIVE ∩ booking flags |
| Specific-branch filtering | **No** | Always all eligible branches |
| Per-day branch availability summary | **No** | Flat `slots[]` only |
| Per-slot `branchCode` | Yes | |
| `dayOffset` | Yes | Preserved |
| Correct duration/pricing on wire | **Partial** | Engine duration yes; no price/currency/slotId/start-end on wire |
| Employee-service duration overrides | Same as public plan path | Catalog duration via `resolveSelectedBookingServices` → `durationOverride` |
| Employee / branch schedules, absences, overrides | Yes | Via `listSpecificEmpPublicSlotsMultiDate` |
| Existing bookings + active holds | Yes | Engine |
| Chronological sort across midnight | Yes | date → dayOffset → time → branchCode |
| Public branch + assignment validation | Yes | |
| Partial failure contract (`partial` / warnings) | **Partial** | `meta.failedBranchCodes` only |
| Separate days vs slots contracts | **No** | Single POST returns flat slots |

### Decision

Phase 10C is a **valid engine reuse path** but **does not fully match** the Phase 1C client contract (days/slots shapes, `scope`, localized names, `slotId`, price, partial warnings).

**Action:** Keep Phase 10C unchanged for backward compatibility. Add dedicated routes that share the same AvailabilityEngine through a new orchestration module.

```text
Reuse/extension/new-route decision: NEW dedicated days+slots routes + shared orchestration
(engine reused; Phase 10C left intact)
```

---

## Files changed

### New

- `src/lib/booking/publicBarberMultiBranchAvailability.ts`
- `src/lib/booking/publicBarberMultiBranchAvailabilityPure.ts`
- `src/app/api/public/booking/barbers/[empId]/availability/days/route.ts`
- `src/app/api/public/booking/barbers/[empId]/availability/slots/route.ts`
- `src/lib/__tests__/phase1cMultiBranchBarberAvailability.test.ts`
- `docs/api/public-booking/MULTI_BRANCH_BARBER_AVAILABILITY.md`
- `docs/booking-redesign/phase-1c-backend/PHASE_1C_BACKEND_IMPLEMENTATION_REPORT.md`
- `docs/booking-redesign/phase-1c-backend/CROSS_BRANCH_AVAILABILITY_AUDIT.md` (this audit section mirrored)

### Updated

- `src/lib/booking/publicBookingErrorCatalog.ts` — new stable codes
- `src/lib/booking/publicBookingCors.ts` — route CORS matrix
- `src/lib/booking/publicBookingRateLimitPolicy.ts` — rate families
- `src/lib/booking/publicBookingHealthMetrics.ts` — timing family map
- `src/lib/booking/publicBookingBranchContext.ts` — global-capable routes
- `src/lib/booking/publicBookingAvailability.ts` — cache invalidation hook
- `docs/client-booking-api.md` — index entry
- `docs/public-booking-api.md` — index entry

### Unchanged (regression)

- `POST /api/public/booking/plan`
- `POST /api/public/booking/create`
- Phase 10C cross-branch route + domain

---

## Internal availability service reused

Orchestration entry points:

- `getBarberAvailabilityAcrossBranches({ mode: 'days' | 'slots', … })`
- `getBarberAvailabilityDays`
- `getBarberAvailabilitySlots`

Per branch, calls:

1. `resolvePublicBookingBranchContext`
2. `resolveSelectedBookingServices` (same duration/price rules as plan)
3. `listSpecificEmpPublicSlotsMultiDate` (**canonical engine**)

All existing engine rules remain active: branch hours, employee schedules, overnight, absences/attendance overrides, bookings, holds, min notice, horizon, interval, timezone, cross-midnight conflicts.

---

## Query / performance strategy

- Load barber once; load assignments once for the date window.
- Resolve branch display identity once per eligible branch.
- Resolve services once **per branch** (catalog is branch-scoped) — not per slot.
- Branch evaluation uses **bounded parallelism** (`BRANCH_EVAL_CONCURRENCY = 2`).
- Does **not** HTTP-call public available-slots; calls engine internals.
- Short in-process cache (45s); keys include emp, services, date/range, scope, branch; cleared with create/cancel availability invalidation.
- Request window max **31** days (aligned with `MAX_PUBLIC_BARBER_CALENDAR_DAYS`); engine still clips to branch `maxBookingDaysAhead`.
- Duration logging without customer PII (`empId`, scope, branchCount, timings).

---

## Final contracts

See [MULTI_BRANCH_BARBER_AVAILABILITY.md](../../api/public-booking/MULTI_BRANCH_BARBER_AVAILABILITY.md).

---

## Tests and results

```bash
npx vitest run src/lib/__tests__/phase1cMultiBranchBarberAvailability.test.ts
npx vitest run src/lib/__tests__/bookingPhase10cCrossBranchAvailability.test.ts
npx vitest run src/lib/__tests__/bookingPlan.test.ts
npx vitest run src/lib/__tests__/bookingPublicErrorCatalog.test.ts
npx vitest run src/lib/__tests__/bookingAvailableDays.test.ts
npx vitest run src/lib/__tests__/availabilityBusinessCompletion.test.ts
```

Phase 1C + Phase 10C + plan/error catalog suites: **pass**.  
`bookingPlanSpecificBarber` has a pre-existing assertion on renamed `isTestOrSmokeEmployeeName` (unrelated to 1C).

Covered scenarios (source + pure helpers): assignment scopes, validation codes, partial/hard failure, slot identity, overnight sort, dual-branch same time, plan/create untouched, engine reuse.

---

## Sample responses

Documented in the API guide (all_public days with two branches; slots with `slotId` + `branchCode`).

---

## Partial failure behavior

- `all_public` + mixed success → `partial: true` + `BRANCH_AVAILABILITY_UNAVAILABLE` warnings.
- `all_public` + total failure → non-2xx `AVAILABILITY_UNAVAILABLE`.
- `specific_branch` failure → non-2xx `BRANCH_AVAILABILITY_UNAVAILABLE` (not partial).

---

## Security validation

- Public envelope only; no BranchID / salary / attendance notes.
- Body ignores client price/duration/branchName.
- `branchCode` normalized server-side; parameterized SQL.
- Existing public rate limiting + CORS allowlist.
- Arrays size-capped (services / days).

---

## Plan / create regression status

**Unchanged.** Plan still revalidates assignment, services, slot freshness, price/duration, `dayOffset`. Create still uses plan token + idempotency. Source contract tests assert no 1C imports in plan/create routes.

---

## Remaining limitations

1. Live DB integration proofs for named barbers (Ziad/Kareem/Ahmed/Mahmoud) still rely on domain probe / deploy smoke — unit suite is contract + pure + wiring.
2. English branch names fall back to SalonName or humanized `branchCode` when no English localization exists (no `BranchNameEn` column).
3. Public duration/price follow **plan catalog** rules (not ops emp-duration-only grids); emp duration overrides are not a separate public pricing authority.
4. Phase 10C flat contract remains for older clients; new clients should use days/slots routes.

---

```text
PHASE 1C BACKEND MULTI-BRANCH AVAILABILITY COMPLETED

Existing cross-branch endpoint: audited — insufficient for days/slots contract; left intact
Availability engine reused: yes — listSpecificEmpPublicSlotsMultiDate
Available-days endpoint: POST /api/public/booking/barbers/:empId/availability/days
Available-slots endpoint: POST /api/public/booking/barbers/:empId/availability/slots
Specific-branch filtering: yes (scope=specific_branch + branchCode)
All-public aggregation: yes (scope=all_public)
Slot branch identity: yes (branchCode + slotId)
Chronological sorting: yes (absolute startDateTime)
Overnight/dayOffset: yes
Partial failures: yes (partial + warnings; specific_branch hard-fails)
Plan/create changed: no
Backend tests: phase1cMultiBranchBarberAvailability.test.ts (pass)
Existing regression tests: Phase 10C + plan + available-days + availability business (pass; one unrelated pre-existing plan-security assert)
API documentation: docs/api/public-booking/MULTI_BRANCH_BARBER_AVAILABILITY.md
Remaining limitations: live named-barber smoke; EN branch name fallback; catalog duration parity with plan
```

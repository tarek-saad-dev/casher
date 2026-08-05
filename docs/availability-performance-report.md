# Availability Performance Report

**Date:** 2026-08-03  
**Phase:** 3C True Multi-Window Runtime (extends 2.5)  
**Scope:** Canonical day-plan resolver + batch path + in-memory multi-window iteration (no live DB profiling required for this report; estimates from query inventory + in-memory benchmarks).

Companion: [`docs/availability-phase-3C-implementation.md`](./availability-phase-3C-implementation.md)

---

## 1. SQL queries executed (canonical day-plan batch)

For `resolveEmployeeDayPlansBatch({ empIds: N, businessDate, branchId, transaction? })` → one `loadEmployeeDayPlanInputsBatch`:

| # | Query / helper | Shared across N? | Notes |
|---|----------------|------------------|-------|
| 1 | Weekly windows (`loadWorkingWindowsBatch`) | **Yes** — 1–3 SQL depending on branch/transfer/legacy fill | Parameterized date/branch; `IN (empIds)` |
| 2 | Overrides (`loadBookingOverridesForDate`) | **Yes** — 1 | |
| 3 | Freelance unlocks (`loadFreelanceBookingUnlocks`) | **Yes** — 2 (TblEmp + attendance) | TX-aware as of 2.5; sequential on TX |
| 4 | Attendance + absent | **Yes** — 1 | Folded absent into attendance |
| 5 | Day-off set | **Yes** — 1 | Optional table |
| 6 | Global timing defaults | **Yes** — 0–1 | Cache hit common off-TX; on-TX always 1 read |
| 7 | Daily adjustments (Phase 3A) | **Yes** — 1–2 | Shared across N; not per window |

**Optional / side:** `ensureEmpBranchWorkScheduleTable` DDL may touch pool once (not counted as availability data Q).

**Per-employee after load:** pure `buildEmployeeDayPlanFromInputs` — **0 SQL**.

**Per-window:** **0 SQL** (Phase 3C iterates `effectiveWindows` in memory).

---

## 2. Shared vs repeated queries

### Shared (batch path — target)

All of the above run **once per (branchId, businessDate, empIds[])**.

### Previously repeated (Phase 1 singular day-plan)

Before Phase 2 batching, N employees ≈ **N × (windows + overrides + freelance + attendance + day-off + timing)** ≈ **O(N × 6–8)** queries.

### Remaining repeated queries (outside day-plan batch)

Occupancy (queue/booking intervals) remains batched per employee set / date — not multiplied by window count W.

Public available-days still does occupancy range SQL once, then per-date day-plan batch. Future optimization: range-wide day-plan inputs.

---

## 3. Phase 3C multi-window complexity

Target:

```text
O(K schedule SQL) + O(N employees + W windows + I intervals)
```

**Not:**

```text
O(W SQL)
```

| Scenario | Schedule SQL | CPU |
|----------|--------------|-----|
| 1 emp, 1 window | O(K) | O(I + slots) |
| 1 emp, 5 windows | O(K) same | O(5·slots + I) |
| 20 emps, 3 windows each | O(K) batch | O(20·3·slots + I) |
| Overnight second window | O(K) + optional next-day busy | Same as overnight single |
| Dense occupancy | unchanged busy SQL | more interval walks |
| Many blocked ranges | blocks on day plan / busy | O(B) intersect checks |

| Consumer | Day-plan resolves | Window iteration |
|----------|-------------------|------------------|
| Slot list (`buildBarberContexts`) | 1 batch after contexts | `iterateWindowSlotStarts` |
| Write guard | 1 | containment in memory |
| Reschedule precheck | 1 | containment |
| Queue ETA / day avail | 1 | `findEarliestFitInWindows` / slot starts |
| Timeline + simulate | 1 (timeline); sim reuses `workingWindows` | earliest fit |
| Available-days range | 1 batch **per date** | all windows |

### Before vs after primary-window runtime

| Metric | Before (primary / `[0]`) | After (all windows) |
|--------|--------------------------|---------------------|
| Query count vs W | O(K) schedule | O(K) — unchanged (no SQL per window) |
| CPU | O(N) + slots in 1 window | O(N + W + I) in memory |
| Memory | One window envelope | Full `effectiveWindows` (typically W ≤ 5) |
| Correctness | Missed evening / overnight secondary | Complete containment across all windows |

No per-window SQL was introduced.

---

## 4. Benchmark harness

```text
npx vitest run src/lib/__tests__/availabilityBenchmarks.test.ts
AVAILABILITY_BENCH=1 npx vitest run src/lib/__tests__/availabilityBenchmarks.test.ts
npx vitest run src/lib/__tests__/availabilityPhase3C.test.ts
```

Non-gating: always green. Records timings when `AVAILABILITY_BENCH=1`.

In-memory scenarios: 1 window, 5 windows, 20×3 batch shape, overnight secondary, dense blocks, dense occupancy (earliest-fit).

Live DB timings for `resolveEmployeeDayPlan`, flow-board, timeline, queue estimate should be captured in staging and appended here when available.

---

## 5. Remaining optimization opportunities

1. **Reuse day-plan batch inputs inside `buildBarberContexts`** — contexts still load weekly/overrides before day-plan enrich; could fold into one batch.
2. **Skip freelance queries** when no freelance/exempt employees in the ID set (cheap prefilter).
3. **Migrate `scheduleControlPreview`** off `getDefaultSchedule` to day-plan (removes legacy weekly SQL).
4. ~~**True multi-window slot generation**~~ — **done in Phase 3C**.
5. **Flow-board:** already batch day-status; measure live p95 under load in staging.
6. **Cache branch weekly windows** per (branchId, DOW, effective date) with short TTL for public calendar fan-out.
7. **Available-days:** one range day-plan input load instead of per-date `resolveEmployeeDayPlansBatch`.

---

## 6. Summary

| Metric | Phase 1 singular | Phase 2/2.5 batch | Phase 3C multi-window |
|--------|------------------|-------------------|------------------------|
| Schedule SQL vs N | O(N·K) | O(K) | O(K) (unchanged) |
| Schedule SQL vs W | — | — | O(1) vs W |
| Plan build CPU | O(N) | O(N) | O(N + W) |
| TX consistency | Pool leak | TX-bound | TX-bound |
| Runtime windows | Indexed `[0]` | Helpers + primary | **All windows** |

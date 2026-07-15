# Operations Booking Performance — Phase 3 (Backend Optimization)

**Date:** 2026-07-15  
**Based on:** Phase 1 measurement + Phase 2 UX fix  
**Constraint:** Preserve `SERIALIZABLE`, applock, `assertEmployeeIntervalAvailable`, overnight/`dayOffset`, 409 behavior, and post-response WhatsApp.

---

## 1. Remaining root causes (before Phase 3)

| Stage | Phase 2 warm ≈ | Cause |
| ----- | -------------: | ----- |
| settings/validation | ~1.9s | Uncached `getPublicSettings` + repeated hits |
| `validateBookingSlot` | ~2.8s | Per-barber sequential schedule/attendance + full next-slot grid + duplicate service load |
| transactional guard | ~2.9s | Duplicate settings/schedule + sequential busy loads + pool (not tx) + `Object_ID` each queue load |
| other | ~1.5s | Dual service queries, booking-code prechecks, post-commit `TblPro` names, `getPool` sync side effects |

---

## 2. Query-level timing breakdown (warm, after)

Representative Server-Timing (specific, one service — run B):

| Stage | ms |
| ----- | -- |
| validationMs (settings) | **1** |
| servicePlanMs | 180 |
| availabilityMs | **583** |
| customerMs | 190 |
| transactionBeginMs | 188 |
| scheduleLockMs | 102 |
| transactionalGuardMs | **642** |
| bookingInsertMs + serviceInsertMs + commitMs | ~272 |
| notificationSchedulingMs | **0** |
| **totalMs** | **2061** |

Child stage DEV logs: `[buildBarberContexts perf]`, `[busy-intervals perf]`, `[assert-available perf]`.

---

## 3. Duplicate work removed

1. **Settings** — short TTL cache + shared in-flight; invalidation on settings update routes.  
2. **Services** — `calculateServicePlanDuration` once per create; passed into `validateBookingSlot`; sequential lines via `buildSequentialServicePlanFromLines`; WhatsApp names from same plan (no post-commit `TblPro`).  
3. **Availability static batch** — day-off, overrides, working windows, absences loaded in parallel; busy loads parallelized per eligible barber; `specific` still evaluates only that barber.  
4. **Next-available grid** — skipped on create when the requested slot is already OK (`skipNextAvailableWhenOk`).  
5. **Guard** — reused settings + schedule after applock; parallel same-day busy; authoritative reads on **transaction** connection when present.  
6. **`Object_ID(QueueTicketServices)`** — process-wide cache.  
7. **`getDefaultDuration`** — uses cached public settings (no second settings SQL).  
8. **Booking code** — generate once; retry only on confirmed unique violation (no pre-insert SELECTs).  
9. **`getPool`** — no longer starts pages/roles sync on every call; sync runs **once** on first successful cloud pool connect.

---

## 4. Cache strategy

| Cache | Scope | TTL | Invalidation |
| ----- | ----- | --- | ------------ |
| Public settings | `globalThis` + in-flight | 45s | `invalidatePublicSettingsCache()` from admin booking-settings PATCH + queue settings update |
| QueueTicketServices exists | module | process life | none (schema stable) |
| Occupancy / busy intervals | **not cached** | — | always re-read after applock |

---

## 5. SQL / execution-plan findings

Warm Azure round trips for emp+date filters are typically **~90–200ms each**.  
After reducing round-trip **count**, remaining latency is mostly network RTT + necessary authoritative re-reads (queue + bookings ± next day).

No clear missing-index evidence justified a migration in this pass (predicates already use `@empId` / `@bdate` parameters). Creating speculative indexes was declined.

---

## 6. Index decision

**No index migration added.**  
Reason: bottleneck was duplicate / sequential round trips, not a proven scan on an unindexed predicate. Revisit with captured Cloud plans if guard stays >1.2s after further RTT reduction.

---

## 7. Files changed

| File | Change |
| ---- | ------ |
| `src/lib/publicBookingHelpers.ts` | Settings TTL cache + invalidation |
| `src/lib/db.ts` | Remove per-`getPool` sync; one-shot sync on cloud connect; `ensureDbRegistrySync` export |
| `src/lib/queueEstimateEngine.ts` | Cached services-table probe; default duration from settings |
| `src/lib/bookingAvailabilityEngine.ts` | Batched static loads; parallel busy; skip next-grid when OK; accept `servicePlan` |
| `src/lib/scheduleIntegrity.ts` | Tx-scoped busy; reuse schedule/settings; parallel reads; stage timings |
| `src/app/api/public/booking/create/route.ts` | One service load; skip next-available; code retry-on-dup; no post-commit name SQL |
| `src/app/api/admin/booking-settings/route.ts` | Invalidate settings cache |
| `src/app/api/queue/settings/route.ts` | Invalidate settings cache |
| `src/lib/devStageTiming.ts` | Nested DEV timers |
| `src/lib/__tests__/bookingSettingsCache.test.ts` | Cache / WhatsApp scheduling tests |
| `docs/operations-booking-performance-phase-3.md` | This report |

---

## 8. Query count before and after (representative specific booking)

Approximate Azure round trips on the create critical path (warm):

| Area | Before ≈ | After ≈ |
| ---- | -------: | ------: |
| Settings | 4–8 | **0–1** (cache) |
| Service metadata | 2–3 | **1** |
| Availability static | many sequential | **~4 batched** |
| Availability busy (specific) | 2–4 + Object_ID each | **2–4** (Object_ID once/process) |
| Next-slot full grid | yes | **skipped when OK** |
| Guard schedule+settings | 2–3 | **reused** |
| Guard busy | sequential + often off-tx | **parallel on tx** |
| Booking code precheck | up to 3 | **0** |
| Post-commit service names | 1 | **0** |
| **Estimated total** | **~25–40** | **~10–16** |

---

## 9. Booking POST timing before and after

| Metric | Phase 2 | Phase 3 warm |
| ------ | ------: | -----------: |
| POST total (server) | ~9.1s | **~2.1–3.6s** (median ≈ **2.8s**) |
| settings/validation | ~1.9s | **~1ms** |
| availability | ~2.8s | **~0.6–0.9s** |
| transactional guard | ~2.9s | **~0.6–1.4s** |
| WhatsApp in POST | 0 (Phase 2) | **0** |

Cloud runs (tagged, cancelled):

| Run | Mode | Client ms | Server total ms |
| --- | ---- | --------: | --------------: |
| PHASE3_PERF_A | specific | 7164* | **3578** |
| PHASE3_PERF_B | specific | 2149 | **2061** |
| PHASE3_PERF_C | nearest | 2898 | **2815** |

\*First create after process restart includes residual compile / cold path outside the aggregate timer.

**Preferred 2–4s target: met on warm runs (server).**

---

## 10. Correctness / concurrency regression

```text
bookingDateContract + Phase2 unit + servicePlan + settings cache  → passed
bookingAvailabilityEngine.test.ts                               → passed
bookingPlanConcurrency.integration.test.ts                      → passed
```

Integrity preserved: applock → schedule → authoritative busy → overlap decision unchanged.

---

## 11. Remaining remote latency

Still visible under warm Cloud:

1. `transactionalGuardMs` (~0.6–1.4s) — lock + schedule window + busy RTT  
2. `availabilityMs` (~0.6–0.9s) — still several Azure queries for one barber  
3. `customerMs` (~0.2–0.7s) — phone lookup / insert RTT  
4. Nearest mode loads all barbers’ busy sets (correctness/product tradeoff)

Cannot eliminate all RTTs without changing integrity model.

---

## 12. Deferred improvements

1. Capture Cloud actual plans for Bookings/QueueTickets if guard regresses.  
2. Optional unique index / MERGE for `TblClient.Mobile` concurrency.  
3. Further nearest-mode early-exit busy loading after first free barber (careful with nextAvailable).  
4. Durable WhatsApp outbox (still best-effort `after()`).  
5. Deeper flow-board SQL work (out of Phase 3 scope; warm ~same order).

---

## Flow-board check

Warm flow-board remains ~1s class after warm-up; create still uses Phase 2 deduped refresh. Date normalization unchanged.

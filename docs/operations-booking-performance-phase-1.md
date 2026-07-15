# Operations Booking Performance — Phase 1 (Measurement Only)

**Date:** 2026-07-15  
**Scope:** Measurement and root-cause identification for slow Operations booking at `/operations`.  
**Constraint:** No behavior/pool/lock/date/conflict/SQL-optimizations. Temporary DEV timing logs only.  
**Database:** Cloud/Azure only (no local DB).

---

## 1. Executive summary

Creating a booking from Operations feels slow mainly because **`POST /api/public/booking/create` awaits WhatsApp delivery before returning HTTP 201**, and the modal “جاري الحجز…” state is tied to that POST. In a real Cloud run (booking `BK-MYUEZF` / id `1580`, then cancelled), **total POST was ~37s**, of which **WhatsApp was ~28s**. Secondary confirmable costs on the same request: **`validateBookingSlot` (~2.3s)**, **transactional conflict guard (~2.9s)**, and **settings/validation (~1.7s)**.

After the POST returns, the UI still shows a success screen for **1.5s**, then `onCreated` refreshes flow-board once for the **currently selected board date** (not necessarily the booking date). Flow-board warm total is **~0.9–1.0s** and stage timings now explain the total. Cold Azure pool connect (~2s) remains a confirmed contributor to cold flow-board (~5–7s in prior observations) but was not recreated in this warm-process run.

**No production booking data was left behind** (test booking cancelled via existing public cancel). **No runtime booking rules, locks, dates, or pool logic were changed** beyond DEV measurement instrumentation.

---

## 2. Booking POST timing breakdown

**Endpoint:** `POST /api/public/booking/create`  
**Instrumentation:** `createDevTimer` + DEV `Server-Timing` header  
**Runtime capture (Cloud, `source=operations`):**

| Stage | ms | Notes |
| ----- | -- | ----- |
| `authMs` | 1 | Rate-limit only (public route) |
| `parseMs` | 0 | JSON body |
| `validationMs` | **1733** | Includes `getPublicSettings()` + field checks |
| `poolMs` | 0 | Warm shared cloud pool |
| `availabilityMs` | **2311** | `validateBookingSlot` (pre-validation) |
| `servicePlanMs` | 395 | `buildSequentialServicePlan` |
| `customerMs` | 355 | `upsertCustomer` |
| `transactionBeginMs` | 174 | `SERIALIZABLE` begin |
| `scheduleLockMs` | 87 | `sp_getapplock` inside guard |
| `transactionalGuardMs` | **2878** | Lock + schedule + busy re-read (`assertEmployeeIntervalAvailable`) |
| `bookingInsertMs` | 93 | Booking row |
| `serviceInsertMs` | 88 | BookingServices lines |
| `commitMs` | 93 | Commit |
| `notificationSchedulingMs` | **28323** | **Awaited** `sendBookingWhatsAppMessage` |
| `totalMs` (server) | **36798** | Client observed ~37347 ms |
| HTTP | **201** | `bookingId=1580`, code `BK-MYUEZF` |

Classification:

| Finding | Class |
| ------- | ----- |
| Awaited WhatsApp before 201 (~28s when integration enabled) | **Confirmed bottleneck** |
| `validateBookingSlot` ~2.3s | **Confirmed bottleneck** |
| Transactional guard ~2.9s | **Confirmed bottleneck** / **Contributing latency** |
| `getPublicSettings` inside validation ~1.7s | **Contributing latency** |
| Insert/commit path (<0.5s combined) | **Not involved** (not the perceived multi-second wait) |
| Pre-validation + transactional guard preserved | Confirmed unchanged |

Stage sum ≈ total (small residual = booking-code uniqueness queries / svc name lookup).

---

## 3. Frontend modal lifecycle

Traced in:

- `useBookingWorkspace.handleSubmit`
- `BookingWorkspaceModal` / `BookingWorkspaceFooter` / `BookingWorkspaceSummary`
- `CreateBookingDrawer` (re-export of workspace modal)
- `src/app/operations/page.tsx` (`onCreated` → `fetchFlowBoard`)

### Timeline (code + DEV `ops-booking-perf` logs)

```text
confirm click
→ setSubmitting(true)                         // “جاري الحجز...”
→ POST /api/public/booking/create starts
→ POST returns (includes awaited WhatsApp)
→ setSuccess(true); setSubmitting(false)      // loading label clears HERE
→ wait 1500ms success UI
→ onCreated() + onClose()
→ fetchFlowBoard() starts (board selectedDate)
→ fetchFlowBoard() finishes
```

### What the modal loading state waits for

**Confirmed:** booking POST **only** (including everything the server awaits before 201).

Not waited by `submitting`:

- flow-board refresh
- `router.refresh()` (not used on Operations booking success)
- the 1.5s success delay (runs **after** `submitting` clears)

| Perception | Technical cause |
| ---------- | --------------- |
| “جاري الحجز...” for many seconds | `submitting === true` for full POST duration |
| Brief success then board refresh | 1.5s `setTimeout` then `onCreated` → `fetchFlowBoard` |

Classification: **Confirmed bottleneck** (modal bound to slow POST).

---

## 4. Flow-board request graph

**Sole frontend caller of `/api/operations/flow-board`:** `src/app/operations/page.tsx` → `fetchFlowBoard`.

| File | Function/Hook | Trigger | Date Used | Can Run After Booking? | Can Overlap? |
| ---- | ------------- | ------- | --------- | ---------------------- | ------------ |
| `operations/page.tsx` | `fetchFlowBoard` via `useEffect([fetchFlowBoard])` | Mount / whenever `selectedDate` changes | `selectedDate` | Yes (if date effect re-runs) | Yes (with poll / Strict Mode) |
| `operations/page.tsx` | `setInterval(fetchFlowBoard, 30000)` | 30s polling | `selectedDate` | Yes | Yes |
| `operations/page.tsx` | Booking `onCreated` | After success + 1.5s | `selectedDate` (not auto-switched to booking date) | **Yes — once per booking** | Yes vs poll |
| `operations/page.tsx` | Queue drawers / schedule `onCreated`/`onApplied` | Unrelated ops actions | `selectedDate` | N/A to booking | Yes |
| `operations/page.tsx` | Manual refresh / retry UI | User refresh | `selectedDate` | Yes | Yes |
| Other apps/pages | None found calling this path | — | — | — | — |

No `router.refresh()` on booking success.

Does **not** automatically switch board date to the newly booked date.

---

## 5. Confirmed duplicate request triggers

For **one booking submission** on a single Operations tab, expected flow-board GETs:

| # | Cause | Classification |
| - | ----- | -------------- |
| 1 | Booking `onCreated` → `fetchFlowBoard()` after 1.5s | **Confirmed duplicate trigger** (relative to ambient refresh), intended post-create refresh |
| 0–1 | Coincidence with 30s poll | **Confirmed duplicate trigger** (overlap possible) |
| 0–2 | React Strict Mode double `useEffect` on mount (dev) | **Confirmed duplicate trigger** (dev-only double initial load) |
| Optional | Operator changes `selectedDate` around the same time | **Can Overlap** — not automatic on create |

**Not confirmed as create bugs:**

- Dual dates “board date + booking date” **in the same create path** — create refresh uses **only** `selectedDate`. Dual-date GETs imply date change, another tab, or separate user navigation.
- Child+parent both refreshing — single `onCreated` on page; modal does not independently fetch flow-board.

---

## 6. Flow-board timing breakdown

**Endpoint:** `GET /api/operations/flow-board`  
**Warm Cloud measurements** (`date=2026-07-15` / `2026-07-16`):

| Stage | Warm ~ms | Notes |
| ----- | -------- | ----- |
| `authMs` | 0 | Session handled by proxy; route does no session work |
| `dateParseMs` | 0–1 | |
| `poolMs` | ~1 | Warm pool |
| `colCheckMs` | ~175 | Lifecycle column probe (**was previously unlogged**) |
| `employeesMs` / `bookingsMs` / `queueMs` / `nextDay*` | ~175–192 each | Parallel; wall ≈ **max**, not sum |
| `detailsMs` | ~175 | BookingServices + QueueTicketServices (**previously unlogged**) |
| `otherQueriesMs` | ~350–370 | Entire `getBarbersDayStatus` (schedules/overrides/attendance/day-off) |
| `schedulesMs` / `overridesMs` | 0 (alias) | Nested inside `otherQueriesMs` (not split without engine change) |
| `normalizationMs` | ~0 | Map grouping |
| `scheduleCalculationMs` | ~15–42 | Per-barber timelines |
| `responseBuildMs` / `serializationMs` | ~0 | Small payload stringify |
| **totalMs** | **~910–965** | Matches client ~1.0s |

**Prior cold sample (pre-instrumentation gap):**

```text
dbConnect: 2060ms
batchFetch: 471ms
processData: 432ms
TOTAL: 6557ms   ← gap ≈ missing colCheck + details + getBarbersDayStatus + contention
```

Classification:

| Finding | Class |
| ------- | ----- |
| Unexplained TOTAL gap = missing stage coverage (esp. `getBarbersDayStatus` + details + colCheck) | **Confirmed** measurement gap (now instrumented) |
| Cold `poolMs` / `dbConnect` ~2s | **Confirmed bottleneck** (cold) |
| Warm flow-board ~1s | **Contributing latency** (after modal; not “جاري الحجز”) |
| Overnight next-day queries | Behavior unchanged; part of parallel batch |

---

## 7. Cloud SQL pool lifecycle

**Source of truth:** `src/lib/db.ts`

| Question | Result |
| -------- | ------ |
| Pool per request? | **No** — module-scoped `cloudPool` + `cloudPoolPromise` |
| Simultaneous cold starts? | First caller creates `cloudPoolPromise`; others **await the same promise** while it is non-null |
| Shared pending promise? | **Yes** (`if (cloudPoolPromise) return cloudPoolPromise`) |
| Failed promise cached? | **No** — `.catch` clears `cloudPoolPromise = null` so next call retries |
| Event listeners? | One `error` listener attached when pool is created; reset on error clears pool |
| Who closes pool? | `closePool` / `closeCloudPool` / `setDbTarget` — **no Operations/flow-board/booking route closes it** |
| Why multiple `[db:cloud] Connection attempt 1/3...`? | **Confirmed causes:** (1) **Next.js/Webpack HMR** reloads module → new null globals → new connect; (2) **multiple Node workers / processes** each have their own module state; (3) after pool `error` / close, reconnect starts at attempt 1; (4) fail path retries attempt 2/3 in same call. Concurrent requests in **one** process should share one pending promise **unless** state was cleared/reset between them. |
| Side effect on every `getPool()` | Fire-and-forget `pages-sync` then `roles-sync` (`roles-sync` guards with process `synced` flag) |

Classification: simultaneous “attempt 1/3” under a single stable process is **Needs Phase 2 verification** if still seen without HMR; HMR/multi-instance is **Confirmed** for duplicate cold connects. **Do not fix in Phase 1.**

---

## 8. Notification latency

**Path:** post-commit `await sendBookingWhatsAppMessage(...)` then HTTP 201.

| Question | Result |
| -------- | ------ |
| Awaited before 201? | **Yes** |
| Time added (this run) | **~28323 ms** (`notificationSchedulingMs`) |
| Durable / fire-and-forget? | **Neither durable queue nor fire-and-forget** — inline await of HTTP client |
| Blocks modal? | **Yes** — modal `submitting` waits for full POST |
| Dev gate | `enabled = NODE_ENV==='development' && WHATSAPP_INTEGRATION_ENABLED==='true'` (`whatsapp/config.ts`) |
| This environment | WhatsApp **sent** (`sent:true`, `skipped:false`) — flag enabled locally |

Classification: **Confirmed bottleneck** when integration is enabled. When disabled, returns immediately (`development_only`) → **Not involved**.

---

## 9. Unrelated request findings

| Request | Origin vs Operations booking | Class |
| ------- | ---------------------------- | ----- |
| `/api/operations/flow-board` | Operations page (mount/poll/onCreated) | Involved |
| `/api/public/booking/create` | Workspace submit | Involved |
| `/api/auth/session` | Shared layout / `useSession` | **Not involved** in booking POST path |
| `/api/admin/hr/employee-ledger*` | Admin HR pages | **Not involved** (other tab / navigation) |
| `/api/employees` | HR/admin/queue/bookings pages — **not** Operations booking modal | **Not involved** |
| `roles-sync` / `pages-sync` | Side effect of **any** `getPool()` in process | **Contributing latency** only on first sync; not a booking FE call |

Do not attribute other-tab HR traffic to the Operations booking flow.

---

## 10. Ranked bottlenecks

1. **Awaited WhatsApp on create** (~28s when enabled) — **Confirmed bottleneck**  
2. **Cold Azure SQL connect** (~2s) affecting first create/flow-board in a cold process — **Confirmed bottleneck**  
3. **`validateBookingSlot` / availability engine** (~2.3s) — **Confirmed bottleneck**  
4. **Transactional guard** (`SERIALIZABLE` + applock + busy re-read) (~2.9s) — **Confirmed bottleneck** / integrity cost  
5. **`getPublicSettings` in validation** (~1.7s) — **Contributing latency**  
6. **Warm flow-board ~1s** after modal (plus optional poll overlap) — **Contributing latency** / **Confirmed duplicate trigger** for extra GETs  
7. **1.5s success delay** after POST — UX delay only (not “جاري الحجز”) — **Contributing latency**

---

## 11. Exact recommendations for Phase 2

Do **not** implement here. Recommended measurement-backed Phase 2 items:

1. **Decouple WhatsApp from HTTP 201** — schedule after commit (queue / `waitUntil` / fire-and-forget with logging); keep failures non-blocking for Operations UX.  
2. **Keep `submitting` bound to booking durability only** — never to notification or board refresh.  
3. **Cache / reuse public settings** across slot + create in the same session.  
4. **Profile `validateBookingSlot` SQL** — reduce duplicated schedule/busy work vs create’s transactional guard (without removing either guard).  
5. **Flow-board:** cache column probe; consider coalescing poll + `onCreated` refreshes; split/instrument `getBarbersDayStatus` sub-queries.  
6. **Pool:** ensure single shared promise across HMR via `globalThis` (measure race carefully); never close from request handlers.  
7. **Optional UX:** shorten or parallelize success delay vs refresh; refresh booking date board only when different from `selectedDate`.

---

## Runtime verification record

| Item | Value |
| ---- | ----- |
| Confirm→POST start | Code: immediate after click (~0–20ms); not re-timed in UI this run (API harness used) |
| POST total | **~37.3s client / 36.8s server** |
| POST→modal close | After POST: `submitting` clears immediately; close after **+1500ms** success timer |
| Booking POSTs | **1** |
| Flow-board GETs after create (expected) | **1** from `onCreated` (+ possible poll/Strict Mode extras) |
| Dates | Create `2026-07-16`; board refresh uses page `selectedDate` only |
| Warm flow-board | **~0.91–1.04s**; stages explain total |
| Cold flow-board | Prior observation **~6.5s** with **~2.0s** connect; not re-forced (warm process) |
| Cloud connection attempts during warm verify | No new cold connect (poolMs≈0–1) |
| Notification contribution | **~28.3s**, awaited, message submitted |
| Test booking | `PHASE1_PERF_TEST` / `BK-MYUEZF` / id **1580** — **cancelled** via `POST /api/public/booking/cancel` |

### Chronological order (API harness + code lifecycle)

```text
T+0.0s   POST /create starts
T+~1.7s  validation/settings done
T+~4.0s  validateBookingSlot done
T+~4.4s  service plan + customer done
T+~7.5s  SERIALIZABLE + applock + transactional guard + insert + commit done
T+~35.8s WhatsApp await completes → HTTP 201
T+~35.8s FE would clear submitting / show success
T+~37.3s (+1.5s) onCreated → flow-board GET (~1s warm)
           cancel via public cancel (cleanup)
```

---

## Instrumentation added (DEV-only; behavior preserved)

- `src/lib/devRequestTiming.ts`
- `src/app/api/public/booking/create/route.ts` — stage timings + `Server-Timing`
- `src/app/api/operations/flow-board/route.ts` — aggregate timings + `Server-Timing`
- `src/lib/scheduleIntegrity.ts` — `lastScheduleLockMs` measurement export
- `useBookingWorkspace.ts` / `operations/page.tsx` — concise `ops-booking-perf` logs

**Explicit non-changes:** booking rules, `SERIALIZABLE`, applock, `assertEmployeeIntervalAvailable`, overnight/`dayOffset` handling, pool connect/retry policy, FE refresh policy, historical data.

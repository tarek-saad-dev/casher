# Operations Booking Performance — Phase 2 (Critical Latency Fix)

**Date:** 2026-07-15  
**Based on:** `docs/operations-booking-performance-phase-1.md`  
**Constraint:** Fix user-visible delay and duplicate refresh. Do **not** weaken `SERIALIZABLE`, applock, `assertEmployeeIntervalAvailable`, `validateBookingSlot`, overnight/`dayOffset`, or conflict 409 behavior.

---

## 1. Root cause fixed

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| Modal stuck on “جاري الحجز...” ~37s | `await sendBookingWhatsAppMessage` before HTTP 201 | Schedule WhatsApp with Next.js `after()` post-response |
| Extra ~1.5s after POST | `setTimeout(..., 1500)` before `onCreated`/`onClose` | Close immediately (`BOOKING_SUCCESS_CLOSE_DELAY_MS = 0`) + toast |
| Possible overlapping flow-board GETs | Mount/poll/`onCreated` each calling fetch | Centralized `refreshFlowBoard` with in-flight dedupe by date |
| Refresh of unrelated board date | Always refreshed `selectedDate` | Refresh only when `actualDate === selectedDate`; else “عرض يوم الحجز” |

---

## 2. Notification execution strategy

**Mechanism:** Next.js `after()` via `schedulePostResponse` → `scheduleBookingWhatsAppAfterCommit`.

| Property | Value |
| -------- | ----- |
| Durable outbox? | **No** (none existed in repo) |
| Classification | **Best-effort post-response** (`next_after_best_effort`) |
| Before commit? | Never |
| Blocks HTTP 201? | No |
| Failure → HTTP error? | No (caught + masked log) |
| Double-send in create path? | Scheduled exactly once per successful create |

Response body now returns:

```json
"whatsapp": { "sent": false, "skipped": false, "scheduled": true, "reason": "post_response" }
```

DEV timers: `notificationSchedulingMs` measures schedule overhead only (~0–70ms). POST `totalMs` ends before WhatsApp delivery.

---

## 3. Modal lifecycle before and after

### Before

```text
POST 201 (includes WhatsApp)
→ submitting false
→ success UI
→ wait 1500ms
→ onCreated + onClose
→ await-ish refresh (same tick as close)
```

### After

```text
POST 201 (WhatsApp scheduled after response)
→ submitting false (<100ms of client parse)
→ success toast on parent
→ close modal immediately (0ms delay)
→ onCreated → background refreshFlowBoard if same date (not awaited)
```

Double-submit: `submittingRef` guard + button disabled while `submitting`.

Refresh failure: toast “تم إنشاء الحجز، لكن تعذر تحديث اللوحة…” — booking remains success.

---

## 4. Flow-board refresh architecture

`createFlowBoardRefreshController` in `src/lib/operations/flowBoardRefreshController.ts`:

- `refreshFlowBoard(date, { reason?, force? })`
- In-flight `Map<date, Promise>` — identical dates share one GET
- Stale guard: ignore `onData` if `getSelectedDate() !== requestedDate`
- AbortController on `force` refresh
- Poll (30s) and post-create coalesce through the same map
- Booking on another date: **no** board GET; optional “عرض يوم الحجز” action

---

## 5. Files changed

| File | Change |
| ---- | ------ |
| `src/lib/schedulePostResponse.ts` | **New** — `after()` wrapper |
| `src/lib/bookingPostCommitNotification.ts` | **New** — schedule WhatsApp once, mask phone |
| `src/lib/operations/flowBoardRefreshController.ts` | **New** — dedupe + stale guard |
| `src/lib/operations/bookingWorkspaceSubmit.ts` | **New** — submit guard + close delay + parse success |
| `src/app/api/public/booking/create/route.ts` | Post-commit schedule; no await WhatsApp |
| `src/components/operations/booking-workspace/useBookingWorkspace.ts` | Immediate close, ref guard, `onCreated(result)` |
| `src/app/operations/page.tsx` | Central refresh; date-aware booking callback |
| `src/lib/__tests__/operationsBookingPerfPhase2.test.ts` | **New** unit tests |
| `docs/operations-booking-performance-phase-2.md` | This deliverable |

---

## 6. Test results

```text
vitest operationsBookingPerfPhase2.test.ts + bookingDateContract.test.ts  → 17 passed
vitest bookingPlanConcurrency.integration.test.ts                         → 3 passed
```

Coverage:

- WhatsApp scheduled once; not awaited; rejection swallowed; phone masked
- Submit guard / close delay 0 / parse success / board refresh decision
- Flow-board: dedupe, poll+create coalesce, stale date ignore, other-date no refresh

Integrity regression: concurrency suite still green (locking/conflict unchanged).

---

## 7. Cloud runtime results

Tagged booking: `PHASE2_PERF_TEST` / `BK-YU8V74` / id **1586** on `2026-07-16` — **cancelled** after measurement.

| Metric | Before (Phase 1) | After (Phase 2) |
| ------ | ---------------: | --------------: |
| Booking POST (client) | ~36.8s | **~9.2s** |
| Booking POST (server total) | ~36.8s | **~9.1s** |
| WhatsApp inside POST | ~28.3s | **0** (`notificationSchedulingMs` **66ms**) |
| Modal success delay | 1500ms | **0ms** |
| WhatsApp in response body | delivered result | `scheduled: true` |
| Flow-board GETs after same-date booking | 1 + possible overlap | **≤1** (deduped) |
| Duplicate identical GETs | possible | **0** (shared in-flight) |

Server-Timing (excerpt):

```text
validationMs ~1923
availabilityMs ~2769
transactionalGuardMs ~2856
notificationSchedulingMs ~66
total ~9121
```

WhatsApp no longer appears in POST total.

---

## 8. Remaining latency

Still inside warm create (~9s), unchanged by design this phase:

1. `validateBookingSlot` / availability (~2.5–2.8s)
2. Transactional guard (~2.8–2.9s)
3. `getPublicSettings` / validation (~1.7–1.9s)
4. Service plan + customer + inserts (~1s combined)

Cold pool (~2s) can still add to first request in a cold process.

Preferred target “confirm → 201 under 8s” is not fully met yet; **user-visible WhatsApp wait is gone**. Sub-8s requires Phase 3 backend optimization.

---

## 9. Inputs for Phase 3 backend optimization

1. Profile/cache `getPublicSettings` across slot + create.
2. Reduce duplicated SQL between `validateBookingSlot` and transactional guard (keep both layers).
3. Optionally shrink lock/busy query cost inside `assertEmployeeIntervalAvailable` without removing SERIALIZABLE/applock.
4. Consider durable WhatsApp outbox if best-effort `after()` is insufficient in serverless cold death.
5. Cache flow-board column probe / day-status subqueries.

---

## Confirmations

- Locking, dates, conflict guards: **unchanged**
- No historical data cleanup; test booking cancelled via public cancel
- Phase 1 DEV timers retained; POST total excludes WhatsApp delivery

# Booking Audit — Phase 2: Date & Overnight Display Verification

**Date:** 2026-07-15  
**Based on:** `docs/booking-audit-phase-1-architecture.md`  
**Constraint:** Verification only. No production code changes. No SQL writes. No concurrency work.

---

## 1. Overnight payload trace

Scenario:

```text
Selected board date: 2026-07-15
Selected slot time: 01:00
Selected slot dayOffset: 1
Timezone: Africa/Cairo
```

| Step | Value | Evidence |
| ---- | ----- | -------- |
| `selectedDate` | `2026-07-15` (board day user picked) | Customer `BookingModal.tsx` — slots fetched with `format(selectedDate)` |
| `slot.time` | `01:00` | selected slot |
| `slot.dayOffset` | `1` | selected slot |
| `getActualBookingDate` | **`2026-07-16`** | `BookingModal.tsx` L445–451 (`setDate(+1)` when `dayOffset===1`) |
| `final frontend payload.date` | **`2026-07-16`** | L466–490 (`format(actualDate, "yyyy-MM-dd")`) |
| `final frontend payload.dayOffset` | **`1`** | L468, L492 |
| Backend parsed `date` | `2026-07-16` | `plan/route.ts` L129–131 |
| Backend parsed `dayOffset` | `1` | L131 |
| Backend `bookingDate` | **`2026-07-17`** | L194: `dayOffset===1 ? nextDateStr(date) : date` |
| Inserted `Bookings.BookingDate` | **`2026-07-17`** | L669 / L675–681 (`@bDate` = `seg.date`, starts from `bookingDate`) |
| Inserted `StartTime` | `01:00:00` | L670–671 |
| Inserted `EndTime` | duration-based on first segment (e.g. +30m → `01:30:00`) | L671; cursor from L199 |

Isolated reproduction (pure date math matching `nextDateStr` / FE advance):

```text
Expected stored date: 2026-07-16
Actual stored date:   2026-07-17
```

**Decision:** Customer frontend **and** `/plan` each apply a +1 day → **double `dayOffset`**. Confirmed root cause of wrong calendar date for overnight customer bookings.

Operations contrast (same board scenario): FE sends `date=2026-07-15`, `dayOffset=1` (`useBookingWorkspace.ts` L373–381); `/create` stores `actualDate=2026-07-16` (`create/route.ts` L140, L313). **Correct.**

---

## 2. `/create` vs `/plan` date comparison

API-level cases from the task brief (same inputs into each route):

| Flow | Input date | Input dayOffset | Stored `BookingDate` |
| ---- | ---------: | --------------: | -------------------: |
| Operations `/create` Case A | 2026-07-16 | 0 | **2026-07-16** |
| Operations `/create` Case B | 2026-07-15 | 1 | **2026-07-16** |
| Customer `/plan` Case A | 2026-07-16 | 0 | **2026-07-16** |
| Customer `/plan` Case B (literal API body) | 2026-07-15 | 1 | **2026-07-16** |

With the **actual customer FE overnight path** (board `2026-07-15`, slot `dayOffset=1`):

| Flow | Effective payload `date` | `dayOffset` | Stored `BookingDate` |
| ---- | -----------------------: | ----------: | -------------------: |
| Operations `/create` | 2026-07-15 | 1 | **2026-07-16** |
| Customer FE → `/plan` | 2026-07-16 | 1 | **2026-07-17** |

For `dayOffset=0`, FE does not advance date; both systems store the input date.

---

## 3. SQL driver `BookingDate` type

Read-only probe (`SELECT TOP 1 … FROM dbo.Bookings ORDER BY BookingID DESC`) against configured DB (`last132` / Azure). No rows written.

| Field | Observed |
| ----- | -------- |
| `typeof BookingDate` | `object` |
| Constructor | `Date` |
| `instanceof Date` | `true` |
| Raw / inspect | e.g. `2026-07-15T00:00:00.000Z` |
| `JSON.stringify` | `"2026-07-15T00:00:00.000Z"` |
| Sample `BookingID` | `1287` |
| `StartTime` | also `Date` (epoch date + time), e.g. `1970-01-01T21:00:00.000Z` |

**Conclusion:** `Bookings.BookingDate` is normally a **JavaScript `Date` object**, not a string. Therefore `flow-board`’s branch:

```ts
typeof b.BookingDate === 'string' ? b.BookingDate.split('T')[0] : dateStr
```

(`flow-board/route.ts` L389–391) almost always takes the **`dateStr` (board date)** path.

Correct helper exists elsewhere: `sqlDateToYyyyMmDd` in `bookingDateTime.ts` L57–80 handles `Date`.

---

## 4. Dual-day reproduction

Assumptions for isolated sim (mirrors `flow-board` overnight merge + `inShiftWindow`):

```text
Overnight shift: workStart=14:00, workEnd=02:00 (next calendar day)
Driver BookingDate: Date at UTC midnight of stored day
```

### 4a. User example — stored `2026-07-16` / `01:00`

| Board `dateStr` | Query include? | `bookingDateStr` used (bug) | Normalized start (bug) | `inShiftWindow` (bug) | Appears? |
| --------------- | -------------- | --------------------------- | ---------------------- | --------------------- | -------- |
| 2026-07-15 | yes (next-day merge) | **2026-07-15** (replaced) | 2026-07-15 01:00 Cairo | **false** (before 14:00) | **No** |
| 2026-07-16 | yes (same-day) | 2026-07-16 | 2026-07-16 01:00 Cairo | **false** (before that day’s 14:00) | **No** |

With **correct** date (`sqlDateToYyyyMmDd`): board `2026-07-15` → appears; board `2026-07-16` → does not (01:00 belongs to prior overnight window).

**Same `BookingID` on both board dates for this 01:00 example: Not reproduced** under typical overnight hours. The Date→`dateStr` bug here **hides** the booking on the originating overnight board rather than duplicating it.

### 4b. Dual-day path that **is** reproduced — `BookingDate=2026-07-16`, `StartTime=22:00`

| Board | `bookingDateStr` (bug) | Normalized start | In overnight window? | Appears? |
| ----- | ---------------------- | ---------------- | -------------------- | -------- |
| 2026-07-15 | 2026-07-15 | 15th 22:00 | yes | **Yes** |
| 2026-07-16 | 2026-07-16 | 16th 22:00 | yes | **Yes** |

Correct normalization: only board `2026-07-16` would include it for that shift model (`sameIdBoth_correct: false`, `sameIdBoth_bug: true`).

**Same `BookingID` can appear in both today and tomorrow responses** when:

1. Driver returns `BookingDate` as `Date` (confirmed §3),
2. Barber is overnight (next-day bookings merged — `flow-board/route.ts` L179–197, L361),
3. Mis-normalized start still falls inside the **previous** board’s overnight window (evening / late slots).

### 4c. Interaction with double-offset store (`BookingDate=2026-07-17`, `01:00`)

Wrong-stored overnight from §1 does not land in board `2026-07-15` query set (`next` is only `2026-07-16`). Visible under correct math on board `2026-07-16` overnight next-day merge; board `2026-07-17` morning still outside that day’s afternoon-start overnight window. Separate wrong-day symptom from dual-day display.

---

## 5. Frontend state merging

`src/app/operations/page.tsx` L191–202:

```ts
const data = await res.json();
setFlowBoardData(data); // replace, not append
```

- Replaces entire `flowBoardData` on each fetch.
- No merge / append / `sourceId` dedupe across fetches.
- Changing `selectedDate` refetches and replaces.

**Frontend state merging does not contribute** to seeing the same booking under two days. Duplication requires the **backend response for each day** to include the same `sourceId` (as in §4b), then the user viewing each day separately.

---

## 6. Confirmed root causes

| # | Classification | Finding | Files |
| - | -------------- | ------- | ----- |
| 1 | **Confirmed root cause** | Customer FE advances `date` for `dayOffset=1` and still sends `dayOffset: 1`; `/plan` applies `dayOffset` again → stored date is **+2** from board day (`2026-07-17` instead of `2026-07-16`). | `cut-salon-rtl-booking/.../BookingModal.tsx` L445–492; `casher/.../plan/route.ts` L192–194, L669 |
| 2 | **Confirmed contributing bug** | `flow-board` replaces non-string `BookingDate` with board `dateStr`. Driver returns `Date` (verified). | `flow-board/route.ts` L389–391; `bookingDateTime.ts` L57–80 (correct helper unused here) |
| 3 | **Confirmed contributing bug** (conditional) | Overnight next-day merge + bug #2 can put the **same `BookingID`** on board D and board D+1 when the mis-dated start still sits inside D’s overnight window (reproduced for `22:00` stored on D+1; **not** for `01:00` under 14:00–02:00 shifts). | `flow-board/route.ts` L179–197, L355–373, L376–440 |
| 4 | **Rejected hypothesis** (for duplication) | Operations FE appends/merges flow-board results without dedupe. | `operations/page.tsx` L202 — replace only |
| 5 | **Not reproduced** | Same `BookingID` on both boards for the exact `01:00` / `BookingDate=D+1` example under typical overnight hours — bug tends to **drop** it from board D instead. | Isolated sim §4a |

### Required decisions

1. **Does customer FE/backend apply `dayOffset` twice?** → **Yes.** Confirmed root cause.
2. **Does `flow-board` replace stored next-day date with board date?** → **Yes**, whenever `BookingDate` is a `Date` (normal). Confirmed contributing bug.
3. **Can the same `BookingID` appear in both today and tomorrow responses?** → **Yes**, for some overnight-adjacent clock times (reproduced `22:00` path); **not** for the narrow `01:00` example with 14:00–02:00 overnight.
4. **Is frontend state merging involved?** → **No.**

---

## 7. Minimal fix recommendations (Phase 5 only — do not implement here)

1. **Customer FE:** Send board `selectedDate` as `date` and keep `dayOffset` from the slot — **or** send advanced calendar date with `dayOffset: 0`. Never both. Align with Operations (`useBookingWorkspace`).
2. **`/plan`:** Document contract: `date` = board/operational date; `dayOffset` applied once server-side only. Reject or normalize inconsistent pairs if needed.
3. **`flow-board`:** Use `sqlDateToYyyyMmDd(b.BookingDate)` (or equivalent) instead of `typeof === 'string' ? … : dateStr` at L389–391 (and the analogous queue branch L446–448).
4. After #3, re-verify overnight `inShiftWindow` so next-day morning bookings appear only on the business board that owns the overnight window (not duplicated).

---

## Verification artifacts

- Read-only SQL type probe executed; no inserts/updates/deletes.
- Isolated Node simulation of payload + flow-board branching; temporary scripts removed after run.
- No production routes, helpers, FE payloads, or migrations modified.

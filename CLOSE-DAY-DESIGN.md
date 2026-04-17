# Close Current Business Day — Feature Design

## A. Feature Understanding

The salon operates on a **hierarchical session model**:

```
TblNewDay (Business Day, Status=1 means open)
  └── TblShiftMove (Shift Session, Status=1 means open)
        ├── TblinvServHead (Sales)
        ├── TblinvServPayment (Payments)
        └── TblCashMove (Cash movements)
```

**The problem:** The current system can open days and shifts, but lacks:
1. A proper Close Day flow with summary review and safety checks
2. Smart rollover detection when a new calendar day starts but yesterday's business day is still open
3. A guided resolution flow (close old → open new) for operators

**Close Day** is the bookend operation that finalizes a business day. It must:
- Ensure all shifts for the day are closed first
- Show a financial summary before confirmation
- Detect stale days (open day date < today's calendar date)
- Allow a one-click "close + reopen" guided flow for authorized users

---

## B. Business Rules

| # | Rule | Enforcement |
|---|------|-------------|
| B1 | Only one open day (Status=1) at a time | Checked on open AND close |
| B2 | Cannot close day if open shifts exist | Block with list of open shifts; offer to close them first |
| B3 | Only users with `day.close` permission can close | `UserLevel='admin'` has it; `'user'` does not |
| B4 | Cannot close an already-closed day | Check Status before UPDATE |
| B5 | If open day date < today, show rollover prompt | Compare `TblNewDay.NewDay` vs `CAST(GETDATE() AS DATE)` |
| B6 | Closing a day does NOT delete any data | Only `UPDATE TblNewDay SET Status=0` |
| B7 | Close-and-open: close old day + open new day atomically | Single API, uses SQL transaction |
| B8 | Auto-close shifts option: admin can force-close all open shifts as part of day close | Each shift gets EndDate/EndTime set to NOW |
| B9 | Unpermitted user sees stale-day warning but cannot act | Shows "contact admin" message |

---

## C. UX Design

### C1. Manual Close Day Button
- **Location:** ActiveSessionBar — next to the day indicator, visible only to `day.close` users
- **Label:** `إغلاق اليوم`
- **Behavior:** Opens CloseDaySummaryModal

### C2. Smart Rollover Notification
- **Trigger:** When `TblNewDay.NewDay < today` and `Status=1`
- **Detection points:**
  - On app mount (login / page load)
  - Every 60s via session refresh
  - At midnight via a dedicated timer
- **Modal:** DayRolloverModal with 3 options:
  1. إغلاق اليوم السابق وبدء يوم جديد (close + open)
  2. إغلاق اليوم السابق فقط (close only)
  3. تأجيل (dismiss for 15 minutes)

### C3. Shift Warning
- If open shifts exist when close is requested, show inline warning with shift list
- Offer: "إغلاق جميع الورديات تلقائياً ثم إغلاق اليوم" (force-close shifts + close day)
- Or: "إغلاق الورديات يدوياً أولاً" (dismiss, go handle manually)

### C4. Confirmation Flow
1. Click close → Load summary (API: `/api/day/summary`)
2. Show: sales count, total revenue, payment breakdown, shifts
3. If open shifts → show warning + force-close option
4. Confirm → Close day (+ optionally open new day)
5. Success toast → Session refreshes → UI updates

### C5. Arabic UI Copy
See section J below.

---

## D. Best UI Placement

| Element | Location |
|---------|----------|
| Current day indicator | ActiveSessionBar (already exists) |
| Close day button | ActiveSessionBar, next to day date — admin only |
| Day rollover alert | Full-screen modal over POS — cannot be missed |
| Close day summary | Modal dialog with financials |
| Success/error feedback | Toast notifications |

---

## E. Data Mapping

### Read Operations
| Table | Fields Read | When |
|-------|-------------|------|
| TblNewDay | ID, NewDay, Status | Every session check, rollover detection |
| TblShiftMove | ID, UserID, ShiftID, Status, StartTime | Summary, open-shift check |
| TblUser | UserName | Join for shift display |
| TblShift | ShiftName | Join for shift display |
| TblinvServHead | COUNT, SUM(GrandTotal) | Day summary |
| TblPaymentMethods | PaymentMethod | Payment breakdown |
| TblCashMove | SUM(GrandTolal) by inOut | Cash summary |

### Write Operations
| Table | Operation | Fields Updated |
|-------|-----------|----------------|
| TblNewDay | UPDATE | Status = 0 (close) |
| TblNewDay | INSERT | NewDay, Status=1 (open new) |
| TblShiftMove | UPDATE | Status=0, EndDate, EndTime (force-close shifts) |

---

## F. API / Service Layer

### Existing (already built)
- `GET /api/day` → getCurrentOpenDay
- `POST /api/day/open` → openNewDay
- `POST /api/day/close` → closeCurrentDay (blocks if open shifts)
- `GET /api/day/summary?id=X` → getDaySummary

### New endpoints needed

**1. `GET /api/day/rollover-check`**
Returns: `{ needsRollover, openDay, openDayDate, todayDate, openShifts[], isStale }`

**2. `POST /api/day/close-and-open`**
Body: `{ forceCloseShifts?: boolean }`
Atomically: close all open shifts (if forced) → close day → open new day.
Returns: `{ closedDayID, newDay }`

**3. Update `POST /api/day/close`**
Add body: `{ forceCloseShifts?: boolean }`
If true, auto-close all open shifts before closing day.

---

## G. Frontend Architecture

### New Components
- `src/components/session/DayRolloverModal.tsx` — Smart rollover prompt
- `src/components/session/CloseDayModal.tsx` — Summary + confirm + force-close shifts

### New Hook
- `src/hooks/useDayRollover.ts` — Detection logic + midnight timer + dismiss cooldown

### Modified Components
- `ActiveSessionBar.tsx` — Add close-day button for admins
- `SessionProvider.tsx` — Expose rollover state

---

## H. Validation & Safety

| Check | Where | Response |
|-------|-------|----------|
| No open day found | API + frontend | "لا يوجد يوم عمل مفتوح" |
| Multiple open days | API | Close most recent, log warning |
| Open shifts still active | API | Return shift list; block unless forceCloseShifts=true |
| Already closed day | API | "اليوم مغلق بالفعل" |
| Rollover mismatch | Frontend hook | Show DayRolloverModal |
| Permission denied | API + frontend | 403 + "تواصل مع المسؤول" for non-admin |
| Network failure | Frontend | Toast error, do not corrupt state |

---

## I. Smart Automation Logic

### Detection Triggers
1. **On mount:** SessionProvider fetches session → hook compares `day.NewDay` vs `new Date()` → if stale, set `needsRollover=true`
2. **Every 60s:** Session auto-refresh already runs; hook re-evaluates after each refresh
3. **Midnight timer:** Hook calculates ms until midnight, sets a `setTimeout` → when it fires, triggers one check
4. **After login:** Session fetch runs → same comparison

### Dismiss Cooldown
- When user clicks "تأجيل", store `dismissedUntil = Date.now() + 15min` in state
- Do not show modal again until cooldown expires
- Cooldown resets on page reload (intentional — fresh load should re-warn)

### Non-annoying behavior
- Modal only appears once per trigger (not on every 60s tick)
- After dismiss, 15-minute cooldown before re-prompting
- If user resolves it (close day), modal never reappears
- Non-admin users see a simpler, non-blocking banner instead of a modal

---

## J. Arabic UI Text

### Buttons
- `إغلاق اليوم` — Close day (ActiveSessionBar)
- `إغلاق اليوم السابق وبدء يوم جديد` — Close + open new
- `إغلاق اليوم السابق فقط` — Close only
- `تأجيل` — Dismiss/postpone
- `إغلاق الورديات المفتوحة وإغلاق اليوم` — Force close shifts + day
- `تأكيد إغلاق اليوم` — Confirm close

### Modal: Rollover
- **Title:** `يوم العمل السابق لا يزال مفتوحاً`
- **Body:** `يوجد يوم تشغيل مفتوح بتاريخ {date}. التاريخ الحالي هو {today}. هل ترغب في إغلاق اليوم السابق؟`

### Modal: Close Day Summary
- **Title:** `ملخص اليوم قبل الإغلاق`

### Warnings
- Open shifts: `يوجد {n} وردية مفتوحة. يجب إغلاق جميع الورديات قبل إغلاق اليوم، أو يمكنك إغلاقها تلقائياً.`
- No permission: `لا تملك صلاحية إغلاق يوم العمل. يرجى التواصل مع المسؤول.`
- Already closed: `اليوم مغلق بالفعل`

### Toasts
- Success close: `تم إغلاق يوم العمل بنجاح`
- Success close+open: `تم إغلاق اليوم السابق وفتح يوم جديد بنجاح`
- Error: `حدث خطأ أثناء إغلاق اليوم`

### Non-admin banner
- `يوم العمل الحالي ({date}) قد تجاوز التاريخ الفعلي. يرجى إبلاغ المسؤول لإغلاق اليوم.`

---

## K. Implementation Phases

| Phase | Scope |
|-------|-------|
| 1 | `GET /api/day/rollover-check` endpoint |
| 2 | Update `POST /api/day/close` to support `forceCloseShifts` |
| 3 | `POST /api/day/close-and-open` atomic endpoint |
| 4 | `useDayRollover` hook (detection + midnight timer + cooldown) |
| 5 | `DayRolloverModal` component |
| 6 | `CloseDayModal` component (summary + shift warning + confirm) |
| 7 | Update `ActiveSessionBar` with close-day button |
| 8 | Wire into `page.tsx` (POS page) |
| 9 | Test full flow |

---

## L. First Coding Step

Build in this order:
1. `/api/day/rollover-check` — server-side date comparison + open shift enumeration
2. Update `/api/day/close` — add `forceCloseShifts` support
3. `/api/day/close-and-open` — atomic close+open
4. `useDayRollover` hook
5. `CloseDayModal` + `DayRolloverModal`
6. Wire into ActiveSessionBar + page.tsx

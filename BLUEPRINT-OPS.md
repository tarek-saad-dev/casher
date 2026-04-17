# BLUEPRINT: Users + Permissions + Business Day + Shifts
## Hawai Salon — New Client POS System — Operational Module

---

## A. System Understanding — Operational Model

The existing HawaiDB implements a **hierarchical operational session model**:

```
TblNewDay (Business Day)
  └── TblShiftMove (Shift Session)
        ├── TblinvServHead.ShiftMoveID  (Sales)
        ├── TblinvServPayment.ShiftMoveID (Payments)
        └── TblCashMove.ShiftMoveID     (Cash ledger)
```

### Table Relationships

| Parent | Child | FK | Meaning |
|--------|-------|----|---------|
| TblNewDay | TblShiftMove | TblShiftMove.NewDay = TblNewDay.NewDay | Each shift belongs to a business day |
| TblShift | TblShiftMove | TblShiftMove.ShiftID = TblShift.ShiftID | Each shift session is an instance of a shift definition |
| TblUser | TblShiftMove | TblShiftMove.UserID = TblUser.UserID | Each shift session is opened by a user |
| TblShiftMove | TblinvServHead | TblinvServHead.ShiftMoveID = TblShiftMove.ID | Sales are tied to an active shift |
| TblShiftMove | TblinvServPayment | TblinvServPayment.ShiftMoveID = TblShiftMove.ID | Payments are tied to an active shift |
| TblShiftMove | TblCashMove | TblCashMove.ShiftMoveID = TblShiftMove.ID | Cash movements are tied to an active shift |

### Operational Flow (as proven by live data)

1. **Admin opens a business day** → INSERT into TblNewDay (Status=1)
2. **Operator opens a shift** → INSERT into TblShiftMove (Status=1, NewDay=today, UserID=operator)
3. **Cashier creates sales** → INSERT into TblinvServHead/Detail/Payment + TblCashMove, all referencing ShiftMoveID
4. **Operator closes shift** → UPDATE TblShiftMove SET Status=0, EndDate, EndTime
5. **Admin closes business day** → UPDATE TblNewDay SET Status=0

---

## B. Feature Overview

### B1. Users Management
- View all users from TblUser (excluding soft-deleted)
- Edit user details (name, login, password, default shift)
- Soft-delete users (isDeleted = true)
- Create new users

### B2. Permissions / Roles
- **Current DB reality**: TblUser.UserLevel has only 2 values: `'admin'` and `'user'`
- **No role/permission tables exist** in the database
- The new client will implement a **client-side permission map** keyed by UserLevel
- Optional future enhancement: dedicated TblUserPermissions table

### B3. Business Day Control
- View current day status (open/closed)
- Open a new business day (creates TblNewDay row with Status=1)
- Close the current business day (sets Status=0)
- Enforce: cannot close day while shifts are still open

### B4. Shift Control
- View current shift status
- Open a new shift (creates TblShiftMove row)
- Close the current shift (sets EndDate, EndTime, Status=0)
- View shift summary before closing (sales count, totals, cash breakdown)

### B5. Active Session in POS
- POS header always shows: current user, current day, current shift
- POS blocks sales if no active shift is found
- All new sales automatically inherit the active ShiftMoveID

---

## C. Business Rules

### Day Rules
| # | Rule |
|---|------|
| C1 | Only ONE business day may have Status=1 at any time |
| C2 | Opening a new day requires the previous day to be closed (Status=0) |
| C3 | A day cannot be closed while any TblShiftMove with the same NewDay still has Status=1 |
| C4 | The business day date (TblNewDay.NewDay) determines invDate for all sales in that session |

### Shift Rules
| # | Rule |
|---|------|
| C5 | A shift can only be opened if there is an active business day (TblNewDay.Status=1) |
| C6 | The active shift's NewDay must match the active business day's NewDay |
| C7 | Opening a shift creates a TblShiftMove row with Status=1, StartDate=today, StartTime=now |
| C8 | Closing a shift sets EndDate=today, EndTime=now, Status=0 |
| C9 | A shift cannot be closed twice (already Status=0 → reject) |
| C10 | Multiple shifts per day are allowed (different operators or sequential) |

### Sale Rules
| # | Rule |
|---|------|
| C11 | A sale MUST NOT be created if there is no active ShiftMove (Status=1) |
| C12 | TblinvServHead.ShiftMoveID must equal the current active TblShiftMove.ID |
| C13 | TblinvServHead.invDate must equal the active TblNewDay.NewDay |
| C14 | TblCashMove.ShiftMoveID must equal the current active TblShiftMove.ID |
| C15 | TblCashMove.invDate must equal the active TblNewDay.NewDay |

### Permission Rules
| # | Rule |
|---|------|
| C16 | Only admin-level users can open/close business days |
| C17 | Only admin-level users can manage other users |
| C18 | Both admin and user levels can open/close their own shifts |
| C19 | Both admin and user levels can create sales (within an active shift) |

---

## D. Screen Architecture

### D1. Login Screen (`/login`)
- Simple operator selection or login form
- Fields: loginName + Password
- On success → redirect to POS with user context set

### D2. Users List Screen (`/admin/users`)
- Table of all non-deleted users
- Columns: UserName, loginName, UserLevel, default ShiftName, actions
- Button: Add New User
- Admin-only access

### D3. User Edit Modal/Panel
- Editable fields: UserName, loginName, Password, UserLevel (admin/user), ShiftID (dropdown)
- Save / Cancel buttons
- Soft-delete button

### D4. Business Day Control Panel (`/admin/day`)
- Current day status card (ID, date, status badge)
- "Open New Day" button (if no day open)
- "Close Day" button (if day is open and no open shifts)
- Warning if open shifts exist → must close shifts first
- History: last 10 days

### D5. Shift Control Panel (`/admin/shift`)
- Current shift status card (ID, user, shift name, start time, status)
- "Open Shift" button (if no active shift for this user / or per business rules)
- "Close Shift" button → triggers summary screen first
- History: last 10 shift sessions

### D6. POS Header — Active Session Widget
- Always visible at top of POS screen
- Shows: User name | Day date | Shift name | Shift start time
- Color-coded status: green=active, red=no shift, yellow=closing
- If no active shift → POS is locked with overlay message

### D7. End-of-Shift Summary Screen
- Shown before confirming shift close
- Sales count in this shift
- Total revenue
- Breakdown by payment method (cash, visa, instapay, etc.)
- Cash movement summary (in/out)
- Confirm Close / Cancel buttons

### D8. End-of-Day Summary Screen
- Shown before confirming day close
- All shifts in this day with their totals
- Combined day totals
- Confirm Close / Cancel buttons

---

## E. UX Flows

### E1. Login Flow
```
[Login Screen] → enter loginName + password
  → POST /api/auth/login
  → validate against TblUser (loginName, Password, isDeleted=false)
  → set session cookie / context
  → redirect to /pos or /admin based on UserLevel
```

### E2. Open Business Day Flow
```
[Day Control Panel] → click "Open New Day"
  → check: no existing day with Status=1
  → POST /api/day/open
  → INSERT TblNewDay (NewDay=GETDATE(), Status=1)
  → refresh panel
```

### E3. Open Shift Flow
```
[Shift Control Panel] → click "Open Shift"
  → check: active business day exists
  → select ShiftID (from TblShift dropdown, default from user.ShiftID)
  → POST /api/shift/open
  → INSERT TblShiftMove (NewDay=activeDay, UserID=currentUser, ShiftID, StartDate, StartTime, Status=1)
  → refresh panel → POS unlocked
```

### E4. Selling Flow
```
[POS Page] → verify active session (day + shift)
  → build sale
  → POST /api/sales
  → server enforces: active ShiftMoveID, correct invDate from active day
  → sale saved → print receipt
```

### E5. Close Shift Flow
```
[Shift Control Panel] → click "Close Shift"
  → GET /api/shift/summary?id=4457
  → show End-of-Shift Summary
  → confirm close
  → POST /api/shift/close
  → UPDATE TblShiftMove SET Status=0, EndDate, EndTime
  → POS locked (no active shift)
```

### E6. Close Day Flow
```
[Day Control Panel] → click "Close Day"
  → check: no open shifts for this day
  → GET /api/day/summary?id=2332
  → show End-of-Day Summary
  → confirm close
  → POST /api/day/close
  → UPDATE TblNewDay SET Status=0
```

---

## F. Data Mapping

### F1. TblUser
| Column | Type | Read By | Written By |
|--------|------|---------|------------|
| UserID | int (PK) | Login, ShiftMove, all queries | Auto (identity) |
| UserName | nvarchar | Display everywhere | User edit |
| UserLevel | nvarchar | Permission checks ('admin'/'user') | User edit |
| loginName | nvarchar | Login form | User edit |
| Password | nvarchar | Login validation | User edit |
| ShiftID | int | Default shift for open-shift | User edit |
| CardNO | nvarchar | Not used in POS | — |
| isDeleted | bit | Filter active users | Soft-delete |

### F2. TblShift
| Column | Type | Read By | Written By |
|--------|------|---------|------------|
| ShiftID | int (PK) | Dropdown, ShiftMove | Not written by POS (reference data) |
| ShiftName | nvarchar | Display | Not written by POS |

### F3. TblNewDay
| Column | Type | Read By | Written By |
|--------|------|---------|------------|
| ID | int (PK) | Day control panel | Auto (identity) |
| NewDay | date | Active day, all date references | Open day |
| Status | bit | Active check (1=open, 0=closed) | Open day / Close day |

### F4. TblShiftMove
| Column | Type | Read By | Written By |
|--------|------|---------|------------|
| ID | int (PK) | Active shift, ShiftMoveID for sales | Auto (identity) |
| NewDay | date | Match to business day | Open shift |
| UserID | int | Who opened the shift | Open shift |
| ShiftID | int | Which shift definition | Open shift |
| StartDate | date | Display, summaries | Open shift |
| StartTime | nchar(10) | Display | Open shift |
| EndDate | date | Display, summaries | Close shift |
| EndTime | nvarchar(50) | Display | Close shift |
| Status | bit | Active check (1=open, 0=closed) | Open / Close shift |

### F5. TblinvServHead (relevant columns)
| Column | Usage |
|--------|-------|
| ShiftMoveID | Set to active TblShiftMove.ID on sale create |
| invDate | Set to active TblNewDay.NewDay on sale create |
| UserID | Set to logged-in TblUser.UserID on sale create |

### F6. TblCashMove (relevant columns)
| Column | Usage |
|--------|-------|
| ShiftMoveID | Set to active TblShiftMove.ID on cash entry |
| invDate | Set to active TblNewDay.NewDay |
| invTime | Current time in HH.mm format |

---

## G. Permissions Model

### G1. Current DB Reality
TblUser.UserLevel has exactly **2 values**: `'admin'` and `'user'`.
No role/permission tables exist. No granular permission flags.

### G2. Client-Side Permission Map (DB-Compatible)

The new client maps UserLevel to a capability set **in code only** (no DB changes needed):

```typescript
const PERMISSIONS: Record<string, string[]> = {
  admin: [
    'pos.sell',
    'day.view', 'day.open', 'day.close',
    'shift.view', 'shift.open', 'shift.close',
    'users.view', 'users.edit', 'users.create', 'users.delete',
    'reports.view',
    'settings.view', 'settings.edit',
  ],
  user: [
    'pos.sell',
    'day.view',
    'shift.view', 'shift.open', 'shift.close',
  ],
};
```

### G3. Role Behavior

| Capability | admin | user |
|------------|-------|------|
| Create sales | ✅ | ✅ |
| View day status | ✅ | ✅ |
| Open/close day | ✅ | ❌ |
| View shift status | ✅ | ✅ |
| Open/close own shift | ✅ | ✅ |
| Manage users | ✅ | ❌ |
| View reports | ✅ | ❌ |
| Change settings | ✅ | ❌ |

### G4. Optional Future Enhancement (NOT in current DB)

If granular per-user permissions are needed later:

```sql
-- OPTIONAL: only create if business requires it
CREATE TABLE [dbo].[TblUserPermissions] (
  ID INT IDENTITY(1,1) PRIMARY KEY,
  UserID INT NOT NULL REFERENCES TblUser(UserID),
  Permission NVARCHAR(50) NOT NULL,
  UNIQUE(UserID, Permission)
);
```

**This is NOT needed for Phase 1.** The UserLevel-based map above covers all current operational needs.

---

## H. Business Day / Shift Safety Rules

### H1. Defensive Checks — Open Day
```
IF EXISTS (SELECT 1 FROM TblNewDay WHERE Status = 1)
  → REJECT: "يوجد يوم عمل مفتوح بالفعل — يجب إغلاقه أولاً"
```

### H2. Defensive Checks — Close Day
```
IF EXISTS (SELECT 1 FROM TblShiftMove WHERE NewDay = @dayDate AND Status = 1)
  → REJECT: "يوجد ورديات مفتوحة — يجب إغلاق جميع الورديات أولاً"
```

### H3. Defensive Checks — Open Shift
```
IF NOT EXISTS (SELECT 1 FROM TblNewDay WHERE Status = 1)
  → REJECT: "لا يوجد يوم عمل مفتوح"

-- Business may allow multiple concurrent shifts from different users
-- but check for this user specifically:
IF EXISTS (SELECT 1 FROM TblShiftMove WHERE UserID = @userID AND Status = 1)
  → REJECT: "لديك وردية مفتوحة بالفعل"
```

### H4. Defensive Checks — Close Shift
```
IF NOT EXISTS (SELECT 1 FROM TblShiftMove WHERE ID = @shiftMoveID AND Status = 1)
  → REJECT: "الوردية مغلقة بالفعل أو غير موجودة"
```

### H5. Defensive Checks — Create Sale
```
-- Server-side enforcement (in POST /api/sales)
1. Get active shift: SELECT TOP 1 FROM TblShiftMove WHERE Status = 1 (for current user or any)
   → if none: REJECT "لا يوجد وردية مفتوحة — لا يمكن إنشاء فاتورة"
2. Get active day: SELECT TOP 1 FROM TblNewDay WHERE Status = 1
   → if none: REJECT "لا يوجد يوم عمل مفتوح"
3. Set invDate = TblNewDay.NewDay (NOT GETDATE())
4. Set ShiftMoveID = TblShiftMove.ID
```

### H6. Date Consistency
- **invDate** on sales and cash moves must come from the active TblNewDay.NewDay, NOT from JavaScript Date
- This handles the midnight-crossover case correctly: if the business day is 2026-03-25 and it's now 1:30 AM on 2026-03-26, sales still record as 2026-03-25

---

## I. Frontend Architecture

### I1. Pages
```
/login                    → Login screen
/pos                      → Main POS screen (existing, enhanced)
/admin/day                → Business day control
/admin/shift              → Shift control
/admin/users              → Users management
```

### I2. Components
```
src/components/
  auth/
    LoginForm.tsx            → Login form
  session/
    SessionProvider.tsx      → React context for current session
    SessionGuard.tsx         → Wrapper that blocks content if no session
    ActiveSessionBar.tsx     → POS header session widget
    ShiftRequiredOverlay.tsx → Overlay when no active shift
  day/
    DayStatusCard.tsx        → Current day status display
    DayHistoryTable.tsx      → Recent days list
    DaySummaryPanel.tsx      → End-of-day summary before close
  shift/
    ShiftStatusCard.tsx      → Current shift status display
    ShiftHistoryTable.tsx    → Recent shifts list
    ShiftSummaryPanel.tsx    → End-of-shift summary before close
    OpenShiftDialog.tsx      → Shift selection dialog
  users/
    UsersTable.tsx           → Users list table
    UserEditDialog.tsx       → Create/edit user dialog
```

### I3. Hooks
```
src/hooks/
  useSession.ts             → Access current session from context
  usePermission.ts          → Check if current user has a permission
```

### I4. Library / Services
```
src/lib/
  permissions.ts            → Permission map and helper functions
  session-types.ts          → OperationalSession, User, Day, Shift types
```

### I5. API Routes
```
src/app/api/
  auth/login/route.ts       → POST login
  auth/session/route.ts     → GET current session state
  day/route.ts              → GET current day
  day/open/route.ts         → POST open new day
  day/close/route.ts        → POST close current day
  day/summary/route.ts      → GET day summary for close screen
  day/history/route.ts      → GET recent days
  shift/route.ts            → GET current shift
  shift/open/route.ts       → POST open shift
  shift/close/route.ts      → POST close shift
  shift/summary/route.ts    → GET shift summary for close screen
  shift/history/route.ts    → GET recent shifts
  users/route.ts            → GET all users / POST new user
  users/[id]/route.ts       → GET/PUT/DELETE single user
```

### I6. State / Context
```
SessionContext provides:
  user: { UserID, UserName, UserLevel } | null
  day:  { ID, NewDay, Status } | null
  shift: { ID, ShiftID, ShiftName, StartTime, Status } | null
  permissions: string[]
  isAuthenticated: boolean
  hasActiveShift: boolean
  hasActiveDay: boolean
  refresh: () => void
  logout: () => void
```

---

## J. API / Service Layer

| Method | Route | SQL | Auth |
|--------|-------|-----|------|
| `POST` | `/api/auth/login` | `SELECT * FROM TblUser WHERE loginName=@login AND Password=@pass AND isDeleted=0` | Public |
| `GET` | `/api/auth/session` | Read session cookie → return user + day + shift | Any |
| `GET` | `/api/day` | `SELECT TOP 1 * FROM TblNewDay WHERE Status=1 ORDER BY ID DESC` | Any |
| `POST` | `/api/day/open` | Check no open day → `INSERT TblNewDay (NewDay, Status) VALUES (GETDATE(), 1)` | Admin |
| `POST` | `/api/day/close` | Check no open shifts → `UPDATE TblNewDay SET Status=0 WHERE ID=@id AND Status=1` | Admin |
| `GET` | `/api/day/summary` | Aggregate sales/shifts for the day | Admin |
| `GET` | `/api/day/history` | `SELECT TOP 10 * FROM TblNewDay ORDER BY ID DESC` | Any |
| `GET` | `/api/shift` | `SELECT TOP 1 * FROM TblShiftMove WHERE Status=1 ORDER BY ID DESC` | Any |
| `POST` | `/api/shift/open` | Check day open + no existing open shift for user → INSERT TblShiftMove | Admin/User |
| `POST` | `/api/shift/close` | Build summary → `UPDATE TblShiftMove SET Status=0, EndDate, EndTime` | Admin/User |
| `GET` | `/api/shift/summary` | Sales count, totals, payment breakdown for shift | Admin/User |
| `GET` | `/api/shift/history` | `SELECT TOP 10 * FROM TblShiftMove ORDER BY ID DESC` | Any |
| `GET` | `/api/users` | `SELECT * FROM TblUser WHERE isDeleted=0` | Admin |
| `POST` | `/api/users` | `INSERT TblUser (...)` | Admin |
| `GET` | `/api/users/[id]` | `SELECT * FROM TblUser WHERE UserID=@id` | Admin |
| `PUT` | `/api/users/[id]` | `UPDATE TblUser SET ... WHERE UserID=@id` | Admin |
| `DELETE` | `/api/users/[id]` | `UPDATE TblUser SET isDeleted=1 WHERE UserID=@id` | Admin |

---

## K. Implementation Phases

### Phase 1: Session Read Model + Login (foundation)
- Types and interfaces
- Auth API (login)
- Session context provider
- Login page
- Session cookie management
- GET current day / shift / user APIs

### Phase 2: Business Day Controls
- Day API routes (open/close/summary/history)
- Day control page (/admin/day)
- Safety checks (no double-open, no close with open shifts)

### Phase 3: Shift Controls
- Shift API routes (open/close/summary/history)
- Shift definitions API (GET all from TblShift)
- Shift control page (/admin/shift)
- End-of-shift summary panel

### Phase 4: POS Session Enforcement
- ShiftRequiredOverlay on POS page
- ActiveSessionBar in POS header
- Server-side enforcement: sales API reads active day/shift
- invDate sourced from TblNewDay.NewDay
- ShiftMoveID sourced from active TblShiftMove.ID
- UserID sourced from session

### Phase 5: Users Management
- Users API routes (CRUD)
- Users list page (/admin/users)
- User create/edit dialog

### Phase 6: Permissions Logic
- Permission map (client-side, keyed by UserLevel)
- usePermission hook
- SessionGuard component
- Route protection
- UI element hiding based on permissions

### Phase 7: Summaries + Polish
- End-of-day summary screen
- Shift history with totals
- Day history with totals
- Admin navigation sidebar
- Edge case handling

---

## L. Edge Cases

| # | Scenario | Handling |
|---|----------|----------|
| L1 | System accessed after midnight, previous day still open | POS continues using the open day's NewDay as invDate. Admin closes old day and opens new one when ready. |
| L2 | User tries to sell without active shift | Server rejects with error. POS shows ShiftRequiredOverlay. |
| L3 | User tries to sell without open day | Server rejects. Day control panel prompts to open day first. |
| L4 | Admin closes day while shift is open | Server rejects: "يوجد ورديات مفتوحة" |
| L5 | Two users open shifts simultaneously | Allowed — TblShiftMove supports multiple concurrent open shifts (different UserIDs). Each user's POS uses their own ShiftMoveID. |
| L6 | Power outage during shift close | Shift remains Status=1. On next login, system detects stale open shift and prompts to close it. |
| L7 | User without permission tries to open day | Client-side: button hidden. Server-side: permission check rejects. |
| L8 | Previous day's shift still open | On open-day, server checks for any open shifts globally. Must be resolved first. |
| L9 | Same user tries to open second shift | Server rejects: "لديك وردية مفتوحة بالفعل" |
| L10 | Sale created just as shift is being closed | SERIALIZABLE transaction on sale prevents race condition. |
| L11 | invDate inconsistency | Server always reads TblNewDay.NewDay for invDate, never uses client clock. |

---

## M. First Coding Step

**Phase 1: Session Read Model + Login**

Build in this exact order:

1. `src/lib/session-types.ts` — All TypeScript interfaces
2. `src/lib/permissions.ts` — Permission map
3. `src/app/api/auth/login/route.ts` — Login API
4. `src/app/api/auth/session/route.ts` — Session state API
5. `src/components/session/SessionProvider.tsx` — React context
6. `src/hooks/useSession.ts` — Hook to consume context
7. `src/hooks/usePermission.ts` — Permission check hook
8. `src/app/login/page.tsx` — Login screen
9. `src/middleware.ts` — Route protection middleware
10. Update `src/app/page.tsx` — Wire session into POS

This gives us authentication, session awareness, and the foundation everything else builds on.

---

## N. Folder Structure (proposed additions)

```
pos-system/src/
├── app/
│   ├── login/
│   │   └── page.tsx
│   ├── admin/
│   │   ├── layout.tsx          (admin sidebar layout)
│   │   ├── day/
│   │   │   └── page.tsx
│   │   ├── shift/
│   │   │   └── page.tsx
│   │   └── users/
│   │       └── page.tsx
│   ├── api/
│   │   ├── auth/
│   │   │   ├── login/route.ts
│   │   │   └── session/route.ts
│   │   ├── day/
│   │   │   ├── route.ts        (GET current)
│   │   │   ├── open/route.ts
│   │   │   ├── close/route.ts
│   │   │   ├── summary/route.ts
│   │   │   └── history/route.ts
│   │   ├── shift/
│   │   │   ├── route.ts        (GET current)
│   │   │   ├── open/route.ts
│   │   │   ├── close/route.ts
│   │   │   ├── summary/route.ts
│   │   │   ├── history/route.ts
│   │   │   └── definitions/route.ts
│   │   ├── users/
│   │   │   ├── route.ts
│   │   │   └── [id]/route.ts
│   │   └── ... (existing: sales, barbers, services, etc.)
│   └── page.tsx                (POS — enhanced with session)
├── components/
│   ├── session/
│   │   ├── SessionProvider.tsx
│   │   ├── SessionGuard.tsx
│   │   ├── ActiveSessionBar.tsx
│   │   └── ShiftRequiredOverlay.tsx
│   ├── day/
│   │   ├── DayStatusCard.tsx
│   │   ├── DayHistoryTable.tsx
│   │   └── DaySummaryPanel.tsx
│   ├── shift/
│   │   ├── ShiftStatusCard.tsx
│   │   ├── ShiftHistoryTable.tsx
│   │   ├── ShiftSummaryPanel.tsx
│   │   └── OpenShiftDialog.tsx
│   ├── users/
│   │   ├── UsersTable.tsx
│   │   └── UserEditDialog.tsx
│   ├── auth/
│   │   └── LoginForm.tsx
│   └── pos/
│       └── ... (existing components)
├── hooks/
│   ├── useSession.ts
│   ├── usePermission.ts
│   └── useSaleState.ts        (existing)
├── lib/
│   ├── db.ts                  (existing)
│   ├── types.ts               (existing — extend)
│   ├── session-types.ts       (new)
│   └── permissions.ts         (new)
└── middleware.ts               (new — route protection)
```

---

## O. Key Types / Interfaces

```typescript
// session-types.ts

interface DbUser {
  UserID: number;
  UserName: string;
  UserLevel: 'admin' | 'user';
  loginName: string;
  Password: string;
  ShiftID: number;
  CardNO: string;
  isDeleted: boolean;
}

interface SessionUser {
  UserID: number;
  UserName: string;
  UserLevel: 'admin' | 'user';
}

interface BusinessDay {
  ID: number;
  NewDay: string;     // ISO date
  Status: boolean;    // true = open
}

interface ShiftDefinition {
  ShiftID: number;
  ShiftName: string;
}

interface ShiftMove {
  ID: number;
  NewDay: string;
  UserID: number;
  UserName?: string;
  ShiftID: number;
  ShiftName?: string;
  StartDate: string;
  StartTime: string;
  EndDate: string | null;
  EndTime: string | null;
  Status: boolean;
}

interface OperationalSession {
  user: SessionUser | null;
  day: BusinessDay | null;
  shift: ShiftMove | null;
  permissions: string[];
}

interface ShiftSummary {
  shiftMoveID: number;
  salesCount: number;
  totalRevenue: number;
  paymentBreakdown: { method: string; total: number }[];
  cashIn: number;
  cashOut: number;
}

interface DaySummary {
  dayID: number;
  date: string;
  shiftsCount: number;
  shifts: { id: number; user: string; shift: string; total: number }[];
  totalRevenue: number;
  paymentBreakdown: { method: string; total: number }[];
}
```

---

## P. Implementation Order (files to create)

### Batch 1 — Foundation (build first)
1. `src/lib/session-types.ts`
2. `src/lib/permissions.ts`

### Batch 2 — Auth APIs
3. `src/app/api/auth/login/route.ts`
4. `src/app/api/auth/session/route.ts`

### Batch 3 — Session Context
5. `src/components/session/SessionProvider.tsx`
6. `src/hooks/useSession.ts`
7. `src/hooks/usePermission.ts`

### Batch 4 — Login UI
8. `src/components/auth/LoginForm.tsx`
9. `src/app/login/page.tsx`

### Batch 5 — Middleware
10. `src/middleware.ts`

### Batch 6 — POS Session Enforcement
11. `src/components/session/ActiveSessionBar.tsx`
12. `src/components/session/ShiftRequiredOverlay.tsx`
13. Update `src/app/page.tsx` (wire session)
14. Update `src/app/api/sales/route.ts` (enforce session server-side)

---

*This document is the authoritative reference for the Users + Permissions + Business Day + Shifts module.*
*All implementation must match the existing HawaiDB structure exactly.*
*"Optional future enhancement" items are clearly marked and should NOT be built unless explicitly requested.*

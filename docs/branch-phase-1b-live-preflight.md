# Phase 1B Live Preflight

**Run date:** 2026-07-22 (UTC+3)  
**Status:** **BLOCKED — no Phase 1B migration created or executed**  
**Selected target:** `cloud`  
**Connected database:** `last132`

## Commands run

```bash
node scripts/audit-branches/01-list-tables-and-rowcounts.cjs
node scripts/audit-branches/02-list-constraints-and-indexes.cjs
node scripts/audit-branches/03-branch-readiness-probes.cjs
node scripts/audit-branches/04-phase1b-live-preflight.cjs
npx vitest run src/lib/__tests__/phase1aSecurityBaseline.test.ts
```

All database probes above are read-only (`SELECT` and SQL Server catalog views).

## Phase 1A prerequisite results

| Check | Result |
|---|---|
| Phase 1A security suite | Passed: 1 file, 16 tests |
| `/api/admin/*` absent from anonymous allowlist | Confirmed in `src/lib/proxyPublicRoutes.ts` |
| Login intentionally public | Confirmed: `/api/auth/login` exact allowlist |
| Public booking intentionally public | Confirmed: `/api/public/` prefix allowlist |
| `CRON_SECRET` configured in current environment | **Failed: not configured** |
| Scheduled jobs run in this environment | Confirmed: `npm run dev` starts `scripts/run-nightly-close.ts --watch` |

### Blocking prerequisite

`CRON_SECRET` is not present in the loaded `.env` / `.env.local`, while the default
development command starts the nightly-close watcher. Phase 1A closure explicitly
requires the secret in every scheduled environment before Phase 1B.

No secret value is recorded in this document. Configure a high-entropy
`CRON_SECRET` in the environment that runs the watcher, restart the processes, and
rerun this preflight.

## Live identity counts

| Metric | Count |
|---|---:|
| Total users | 10 |
| Active/current users (`ISNULL(isDeleted, 0) = 0`) | 9 |
| Deleted users | 1 |
| Authoritative admin users | 4 |
| Non-admin users | 5 |
| Total employees | 30 |
| Active employees (`ISNULL(isActive, 1) = 1`) | 13 |
| Inactive employees | 17 |

The authoritative admin count matches current server logic: legacy
`UserLevel = 'admin'` or an active `admin` / `super_admin` role.

## Live primary keys

| Table | Constraint | Primary key |
|---|---|---|
| `dbo.TblUser` | `PK_TblUser` | `UserID INT` |
| `dbo.TblEmp` | `PK_TblEmp` | `EmpID INT` |

## Existing branch-like schema

* No table name containing `Branch` or `Salon` exists.
* No operational table has a `BranchID`, `BranchId`, or `branch_id` column.
* Existing nullable `SalonID INT` columns:
  * `dbo.TblClientReferral`
  * `dbo.TblLoyaltyStoreCategory`
  * `dbo.TblLoyaltyStoreItem`
  * `dbo.TblMysteryBoxReward`
  * `dbo.TblReferralReward`
* Every current row in those five tables has `SalonID IS NULL`; there are zero
  distinct non-null salon identifiers.

## Business-day and uniqueness observations

* One open `TblNewDay` row: ID `4453`, date `2026-07-21`.
* Three open `TblShiftMove` rows at probe time.
* No duplicate `TblNewDay.NewDay`, attendance employee/work-date, target
  employee/work-date, budget year/month, or queue ticket code/date values found.
* Live unique constraints include:
  * `UQ_QueueTickets_Code_Date`
  * `UX_Bookings_BookingCode`
  * `UQ_TblBudgetMonth_YearMonth`
  * `UQ_TblEmpAttendance_Emp_WorkDate`
  * `UQ_TblEmpDailyTarget_Emp_WorkDate`

## Schema differences from repository assumptions

1. The selected cloud database is named `last132`, not the fallback
   `HawaiRestaurant` named in `src/lib/db.ts` and the Phase 0 summary. This may be
   intentional environment configuration, but it must be explicitly confirmed
   before any schema mutation.
2. `TblEmp` uses nullable `isActive BIT`, not `isDeleted`, as its active-state
   source. Application lists treat `ISNULL(isActive, 1) = 1` as active.
3. `TblUser` active state is `isDeleted = 0`. There is no separate `TblUser.isActive`
   column in live schema or app code. Login already filters `isDeleted = 0`.
4. The live DB contains additional legacy tables not fully represented by
   repository migrations, including `TblCalendarSync`, `TblCalendarOutboundSync`,
   purchase/return tables, printer tables, offers, and product movement tables.
5. `UQ_TblBudgetMonth_YearMonth` exists live even though Phase 0 noted no
   repository migration defining that unique key.

## Session / auth readiness notes for the next Phase 1B attempt

Captured from live code inspection after preflight ([Inspect session foundation code](8432706a-8d33-4b72-86d7-65ebf1442589)):

* Current cookie payload is only `{ UserID, UserName, UserLevel, iat }` in
  `src/lib/session-types.ts` / `src/lib/session.ts`.
* `getSession()` validates HMAC + expiry but does **not** re-check
  `TblUser.isDeleted = 0`; soft-deleted users can keep a cookie until expiry.
* Login uses authoritative DB roles via `getUserAccess`; `GET /api/auth/session`
  still returns legacy `getPermissions(UserLevel)` strings — unify carefully if
  exposing active branch there.
* No dedicated login/session unit tests exist yet; Phase 1B session claim work
  should add encode/decode, login mapping-failure, and revoked-access tests.
* `SESSION_SECRET` still has a hardcoded development fallback; production must
  require an explicit secret before relying on signed branch claims.
* Proxy checks cookie presence only; branch validation must remain in
  server-side session/auth helpers, not the edge allowlist.

## GLEEM historical assumption

No live evidence contradicts the frozen assumption that current operational and
financial history belongs to the founding branch:

* no branch registry or operational branch columns exist;
* all existing `SalonID` values are null;
* the application currently operates with one open business-day row;
* no duplicate date/business keys suggest independently operating branch rows.

However, SQL metadata cannot prove the physical location where historic
transactions occurred. The frozen business decision naming GLEEM remains the
authoritative assertion. Before backfill, an operator must explicitly confirm
that `last132` is the intended database and that its history is the GLEEM history.

## Decision

**NO-GO for creating or running `add-multi-branch-foundation.sql` in this run.**

Required confirmations:

1. Configure `CRON_SECRET` in every environment running scheduled jobs.
2. Confirm that cloud database `last132` is the intended migration target.
3. Confirm that `last132` historical operations belong to
   `GLEEM — جليم – سابا باشا`.
4. Prefer a maintenance window because three shifts were open during preflight.

After those items are confirmed, rerun all four read-only probes and the Phase 1A
security suite before creating or executing the Phase 1B migration.

---

# Rerun — 2026-07-22T01:02Z — BLOCKED

**Status:** **NO-GO — Phase 1B migration was not created and was not executed**  
**Operator assertions accepted for this attempt:** maintenance window claimed; target
`cloud` / `last132`; history belongs to `GLEEM` / `جليم – سابا باشا`.  
**Hard gate:** open-shift verification and secret presence still failed.

## Commands run

```bash
node scripts/audit-branches/01-list-tables-and-rowcounts.cjs
node scripts/audit-branches/02-list-constraints-and-indexes.cjs
node scripts/audit-branches/03-branch-readiness-probes.cjs
node scripts/audit-branches/04-phase1b-live-preflight.cjs
node scripts/audit-branches/05-phase1b-gate-check.cjs
npx vitest run src/lib/__tests__/phase1aSecurityBaseline.test.ts
```

## Gate results

| Check | Result |
|---|---|
| Connected database | `last132` |
| Database mode | `cloud` |
| `CRON_SECRET` configured | **Failed — key absent from `.env` / `.env.local`** |
| `SESSION_SECRET` configured | **Failed — key absent from `.env` / `.env.local`** |
| Secret values printed | No |
| Open shift count (`ISNULL(Status,0)=1`) | **3 — must be 0** |
| Open `TblNewDay` inspected only | Yes — ID `4453`, NewDay `2026-07-21`, Status open. **Not modified.** |
| Foundation tables (`TblBranch`, `TblUserBranchAccess`, `TblEmpBranchAssignment`) | None present |
| Operational / financial `BranchID` columns | None |
| `SalonID` values | Still all null; no contradiction to GLEEM history claim |
| Phase 1A security tests | Passed (16) |
| Login / public booking remain public allowlist | Confirmed (unchanged Phase 1A surface) |
| `/api/admin/*` remains protected | Confirmed |

## Open shifts (read-only; not closed)

| Shift ID | UserID | UserName | StartDate | StartTime | NewDay |
|---:|---:|---|---|---|---|
| 10806 | 15 | Hoda | 2026-07-21 | 01:52 PM | 2026-07-21 |
| 10807 | 13 | Tarek | 2026-07-21 | 04:43 PM | 2026-07-21 |
| 10808 | 16 | OMAR | 2026-07-21 | 08:21 PM | 2026-07-21 |

These rows were **not** closed automatically. Closing them remains an operator
action outside Phase 1B.

## Decision

**STOP.** Per Phase 1B critical execution rule, open shifts must be zero before
any foundation migration is created or run. Secrets required by Phase 1A for
scheduled environments are still missing from the loaded env files.

No schema change, session change, branch domain module, or branch API was added
in this rerun beyond the read-only gate helper
`scripts/audit-branches/05-phase1b-gate-check.cjs`.

### Required before the next attempt

1. Operator closes the three open shifts (or confirms they are closed) using
   normal salon/shift procedures — not by this migration.
2. Re-verify:

   ```sql
   SELECT COUNT(*) AS OpenShiftCount
   FROM dbo.TblShiftMove
   WHERE ISNULL(Status, 0) = 1;
   ```

   Result must be `0`.
3. Configure non-empty `CRON_SECRET` and `SESSION_SECRET` in the environment
   that runs the app / nightly watcher (values must not be pasted into chat or
   docs).
4. Rerun probes `01`–`05` and Phase 1A tests; only then create and run
   `add-multi-branch-foundation.sql`.

---

# Rerun — 2026-07-22T01:10Z — GO (revised operator decision)

**Status:** **COMPLETE — Phase 1B foundation migrated and verified on `last132`**

## Revised operator decision (final)

* Maintenance window explicitly confirmed; no new business writes expected
* Target remains `cloud` / `last132`
* History belongs to `GLEEM` / `جليم – سابا باشا`
* Open `TblShiftMove` rows are **no longer a hard blocker**
* Phase 1B must not close, update, or delete them
* Missing secrets may be generated locally into `.env.local` (gitignored); values never printed

## Preconditions performed

* Generated local `SESSION_SECRET` and `CRON_SECRET` into `.env.local` when missing (256-bit each)
* Confirmed `.env*` is gitignored
* Stopped nightly-close watcher and `next dev` during migration
* Captured legacy open day / open shifts / ops fingerprints before migration

## Open shifts treated as legacy state

| Shift ID | UserID | UserName | StartDate | StartTime |
|---:|---:|---|---|---|
| 10806 | 15 | Hoda | 2026-07-21 | 01:52 PM |
| 10807 | 13 | Tarek | 2026-07-21 | 04:43 PM |
| 10808 | 16 | OMAR | 2026-07-21 | 08:21 PM |

Open `TblNewDay` ID `4453` inspected only. Before/after checksums for open day, open shifts, invoices, cash, attendance, bookings, and queue tickets were identical.

## Migration result

* Created `TblBranch`, `TblUserBranchAccess`, `TblEmpBranchAssignment`
* Seeded GLEEM once by `BranchCode`
* Mapped 9 current users; assigned 13 active employees
* Idempotent second execution passed
* Verifier passed (open shifts reported as legacy warning only)
* No operational `BranchID` columns added

## Documentation

* `docs/branch-phase-1b-schema.md`
* `docs/branch-phase-1b-session-context.md`
* `docs/branch-phase-1b-backfill.md`
* `docs/branch-phase-1b-verification.md`
* `docs/branch-phase-1b-closure.md`

Previous blocked attempts above are preserved as audit evidence.

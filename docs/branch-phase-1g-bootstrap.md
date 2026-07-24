# Phase 1G — Branch Bootstrap

**Status:** Implemented  
**Date:** 2026-07-24  
**Database target:** cloud / `last132` (default; refuses unexpected DB name)  
**Does not:** open days/shifts, create payroll/attendance/ledger, add a branch switcher, or invent a second branch without `--confirm`

## 1. One-command bootstrap

```bash
npx tsx scripts/bootstrap-branch.ts \
  --branch-code=SIDIBISHR \
  --branch-name="سيدي بشر" \
  --short-name=SB \
  --address="..." \
  --phone="..." \
  --timezone=Africa/Cairo \
  --cutoff=04:00 \
  --copy-settings-from=GLEEM \
  --seed-partner-shares-from=GLEEM \
  --grant-user-id=12 \
  --assign-emp-id=34 \
  --readiness \
  --confirm
```

Without `--confirm` the script is a **dry run**: connects, validates args, prints the plan, writes nothing.

Minimal write example:

```bash
npx tsx scripts/bootstrap-branch.ts \
  --branch-code=... \
  --branch-name=... \
  --confirm \
  --readiness
```

## 2. CLI options

| Flag | Default | Purpose |
|---|---|---|
| `--branch-code` / `--branch-name` | required | Identity for `TblBranch` |
| `--short-name` | none | Optional; unique among non-null values |
| `--address` / `--phone` | none | Branch metadata |
| `--timezone` | `Africa/Cairo` | `TblBranch.TimeZone` |
| `--cutoff` | `04:00` | `BusinessDayCutoffTime` |
| `--copy-settings-from` | `GLEEM` | Template for `QueueBookingSettings` |
| `--seed-partner-shares-from` | `GLEEM` | Copy open-ended partner share periods |
| `--skip-partner-shares` | off | Skip partner share seeding |
| `--grant-user-id` | none | Grant `CanOperate` + `CanViewReports` (`IsDefault=0`) |
| `--assign-emp-id` | none | Ensure active `TblEmpBranchAssignment` with `CanReceiveBookings=1` |
| `--readiness` | off | Print `evaluateBranchOperationalReadiness` JSON after writes |
| `--confirm` | off | Required to write |
| `--mode` / `--expected-database` | `cloud` / `last132` | Safety gates |

Never prints passwords or connection strings.

## 3. Flow (order of operations)

When `--confirm` is set:

1. **`TblBranch`** — `createBranchRecord` if `BranchCode` missing; otherwise reuse existing row (idempotent for re-runs)
2. **`QueueBookingSettings`** — `ensureQueueBookingSettingsForBranch` (copy from `--copy-settings-from`, default GLEEM); skip if row already exists for that `BranchID`
3. **Partner shares** — `seedPartnerSharesFromSourceBranch` unless `--skip-partner-shares`; validates sum ≈ 100%
4. **User access** (optional) — `grantUserBranchAccess`: insert or reactivate; **never** sets `IsDefault=1` (does not steal GLEEM login default); currently-valid rows are left untouched
5. **Employee assignment** (optional) — `ensureEmployeeBranchAssignment` for today with bookings enabled
6. **Readiness** (optional) — print checklist report for the new `branchId`

Helpers live in `src/lib/branch/bootstrap.ts` (+ `assignmentIntegrity.ts` / `readiness.ts`). Public re-exports: `src/lib/branch/index.ts`.

## 4. Migration (identity uniqueness)

`db/migrations/add-second-branch-readiness.sql` (idempotent; **does not** insert a second branch):

* `UQ_TblBranch_BranchName` — unique display name  
* `UX_TblBranch_ShortName_NotNull` — filtered unique index on `ShortName WHERE ShortName IS NOT NULL` (multiple NULLs allowed)

Runner:

```bash
npx tsx scripts/run-second-branch-readiness-migration.ts \
  --mode=cloud \
  --expected-database=last132 \
  --confirm-maintenance
```

Requires `--confirm-maintenance`. Runs verifier afterward. No data backfill — uniqueness only.

`assertBranchIdentityAvailable` in `bootstrap.ts` checks code / name / shortName collisions before insert (409 on conflict).

## 5. Related probe

Read-only live probe (uniques + GLEEM settings/partners):

```bash
node scripts/audit-branches/11-phase1g-live-probe.cjs
```

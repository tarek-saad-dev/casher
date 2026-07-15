# Employee Daily Target ↔ Ledger Integration Audit (Phase 4)

**Date:** 2026-07-15  
**Scope:** Read-only inspection of `TblEmpLedgerEntry`, dual-write, ledger APIs/UI, and Phase 3 generation — then baseline for Phase 4 writes.

---

## 1. Actual schema — `dbo.TblEmpLedgerEntry`

Source: `db/migrations/create-tbl-emp-ledger-entry.sql`

| Column | Type | Notes |
|--------|------|--------|
| `ID` | `INT IDENTITY` | PK |
| `EmpID` | `INT NOT NULL` | FK → `TblEmp` |
| `EntryDate` | `DATE NOT NULL` | |
| `EntryDirection` | `NVARCHAR(10)` | `credit` \| `debit` |
| `EntryReason` | `NVARCHAR(40)` | includes `target` |
| `Amount` | `DECIMAL(12,2) NOT NULL` | `CHECK (Amount > 0)` |
| `PayrollMonth` | `NVARCHAR(7) NULL` | `YYYY-MM` |
| `RefType` | `NVARCHAR(80) NULL` | |
| `RefID` | `INT NULL` | |
| `CashMoveID` | `INT NULL` | FK → `TblCashMove` |
| `AttendanceID` | `INT NULL` | |
| `Notes` | `NVARCHAR(500) NULL` | |
| `IsVoided` | `BIT NOT NULL` | default 0 |
| `VoidReason` | `NVARCHAR(500) NULL` | |
| `CreatedByUserID` | `INT NULL` | |
| `CreatedAt` | `DATETIME2(0)` | |
| `UpdatedAt` | `DATETIME2(0) NULL` | **no** `UpdatedByUserID` |

`EntryReason` CHECK allows: `hourly_wage`, `monthly_salary`, `target`, `commission`, `bonus`, `advance`, `payout`, `deduction`, `settlement`, `adjustment`, `employee_funding`.

---

## 2. Fields required for a Target ledger entry

| Field | Value |
|-------|--------|
| EmpID | `TblEmpDailyTarget.EmpID` |
| EntryDate | `WorkDate` |
| EntryDirection | `credit` |
| EntryReason | `target` (**not** `commission`) |
| Amount | `TargetAmount` rounded to 2dp (`> 0`) |
| RefType | `TblEmpDailyTarget` |
| RefID | `TblEmpDailyTarget.ID` |
| PayrollMonth | `WorkDate` → `YYYY-MM` |
| CashMoveID | `NULL` |
| AttendanceID | `NULL` |
| Notes | `استحقاق تارجت يومي بتاريخ YYYY-MM-DD` |
| CreatedByUserID | actor on INSERT |
| IsVoided | `0` |

---

## 3. Constraints / indexes today

| Name | Kind |
|------|------|
| `UX_TblEmpLedgerEntry_ActiveRefReason` | Unique `(RefType, RefID, EntryReason)` where `IsVoided=0` and Ref not null — **already blocks duplicate active target refs** |
| `IX_TblEmpLedgerEntry_EmpID_EntryDate` | Non-unique |
| `IX_TblEmpLedgerEntry_PayrollMonth` | Filtered |
| `IX_TblEmpLedgerEntry_EntryReason` | Non-unique |
| `IX_TblEmpLedgerEntry_CashMoveID` | Filtered |
| `IX_TblEmpLedgerEntry_RefType_RefID` | Filtered |

Phase 4 still adds an explicit filtered unique index for daily-target refs (idempotent migration + duplicate pre-check).

---

## 4. How salary (الأساسي) is written today

File: `src/lib/services/employeeLedgerDualWrite.ts`

- Gate: `EMP_LEDGER_DUAL_WRITE_ENABLED === 'true'`
- Same transaction as daily payroll generate
- `RefType = TblEmpDailyPayroll`, `RefID = payrollId`, `EntryReason = hourly_wage`, `CashMoveID = NULL`
- Zero wage → **soft void** (`IsVoided=1`), not delete
- Upsert by RefType/RefID/EntryReason without MERGE

---

## 5. Salary KPI aggregation

`employeeLedgerService.getEmployeeLedgerSummary`:

```
salaryCredits = credit AND EntryReason IN ('hourly_wage','monthly_salary') AND IsVoided=0
```

Does **not** include `target`, `commission`, `bonus`, `employee_funding`.

---

## 6. Target / commission KPI aggregation

```
targetCredits = credit AND EntryReason IN ('target','commission','bonus') AND IsVoided=0
```

- Label in UI: «تارجت / عمولة»
- **No production INSERT** for `target` or `commission` existed before Phase 4
- Legacy monthly `TargetMinSales` / `sp_GetMonthlyPayroll` do **not** write ledger today → no double-count from that path yet (documented residual risk)

---

## 7. Risks before writing

1. `Amount DECIMAL(12,2)` + `CHECK > 0` → zero target must **delete** entry (spec), not insert 0.
2. Existing active-ref unique index + race → need UPDLOCK/HOLDLOCK + unique-error retry like Phase 3.
3. Dual-write flag gates **salary** only; Phase 4 target sync should run with target generate (entitlement, no CashMove) independently of payout CashMove path.
4. Soft-void vs hard-delete difference from hourly_wage — do not reuse void path for target zero.
5. Future cascade: deleting `TblEmpDailyTarget` must delete matching ledger row in same TX (document; no delete API in Phase 4).
6. Double-counting risk if legacy monthly commission is later posted as `commission` while daily `target` also exists — defer to later phase.

---

## 8. Files planned to change / add

**Add**

- `docs/employee-daily-target-ledger-integration-audit.md` (this file)
- `db/migrations/add-employee-daily-target-ledger-unique-index.sql` + runner
- `src/lib/payroll/employee-target/employee-daily-target-ledger.*.ts` (repo, sync, schemas, query/reconcile)
- `src/app/api/payroll/daily/targets/ledger-sync/route.ts`
- `src/app/api/payroll/daily/targets/[id]/route.ts` (snapshot details for UI)
- `scripts/verify-employee-daily-target-ledger.ts`
- Unit/UI tests for sync + reconcile + panel details

**Modify**

- `employee-daily-target-generation.service.ts` — sync ledger inside target TX
- `employee-daily-target.repository.ts` — `getDailyTargetById` / month lists as needed
- `index.ts` — exports
- `EmployeeLedgerPanel.tsx` — clickable target row + details dialog; reason label «تارجت يومي»
- `src/lib/types/employee-ledger.ts` — label tweak if needed

---

## Feature flags

| Flag | Relevance |
|------|-----------|
| `EMP_LEDGER_DUAL_WRITE_ENABLED` | Gates salary/advance/payout/funding CashMove dual-write — **not** a gate for target entitlement sync |
| `EMP_LEDGER_DISABLE_LEGACY_POST_TO_CASH` | Unrelated to daily target |

---

## Cascade rule (Phase 4 documentation)

If `TblEmpDailyTarget` is hard-deleted in a future explicit path, the matching active ledger row  
`(RefType=TblEmpDailyTarget, RefID=ID, EntryReason=target)` must be deleted in the **same** SQL transaction. No delete API ships in Phase 4.

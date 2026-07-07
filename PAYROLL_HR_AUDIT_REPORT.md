# Payroll & HR System — Full Audit Report

**Project:** `casher` (Cut Salon POS/ERP)  
**Scope:** Payroll, attendance, advances/deductions, salary settings, HR pages, and related reports.  
**Audit date:** 2025-06-09  
**Status:** Code-only review (runtime/database not exercised)

---

## 1. Executive Summary

The project has a mature payroll/HR subsystem with clear separation of concerns:

- **Frontend:** `/admin/hr` and `/admin/attendance` act as operational dashboards; `/expenses/salaries` is a separate tabbed salary console.
- **Backend:** Next.js App Router API routes for payroll, attendance, deductions, and employee settings.
- **Database:** SQL Server, relying on `mssql`, stored procedures, and trigger-maintained columns.
- **Financial integration:** Daily payroll and employee advances are mirrored as `TblCashMove` expense/income pairs.

**Key strengths**
- Atomic SQL transactions for payroll posting and advance creation.
- Hourly-rate auto-calculation via trigger `trg_TblEmp_CalcHourlyRate`.
- Attendance late/early-leave calculations in `@/lib/timeUtils`.
- Idempotent migration scripts in `db/migrations/` and `sql/payroll-migration.sql`.

**Critical findings**
1. **SQL syntax error in `/api/deductions/monthly-summary/route.ts`** (`TblExpCatEmpMap` alias missing closing bracket) — route will currently throw.
2. **Duplicate UI real estate:** `/admin/hr`, `/admin/employees`, `/expenses/salaries`, `/expenses-review/advances`, `/expenses-review/salaries`, and `/admin/attendance` overlap; two pages are empty placeholders.
3. **Missing page registry entries:** `/admin/employees`, `/admin/attendance/daily-payroll`, and `/expenses/salaries` are not listed in `SYSTEM_PAGES`, so permission sync may not cover them.
4. **Daily payroll generation does not persist late/early-leave minutes** or pay-impact calculations; only `ActualHours` and `DailyWage` are stored.

---

## 2. Module Inventory & Navigation Mapping

### 2.1 Navigation source
Navigation is defined in `src/components/layout/nav-config.ts` and synced to `TblSystemPages` via `src/lib/pages-registry.ts`.

```@/Users/...casher/src/components/layout/nav-config.ts:138-148
{
  title: 'الموارد البشرية',
  icon: UsersRound,
  items: [
    { href: '/admin/hr',                        label: 'الموظفون',          icon: UsersRound },
    { href: '/admin/attendance',                label: 'متابعة الحضور',    icon: Clock      },
    { href: '/admin/attendance/daily-payroll',  label: 'يوميات الموظفين',  icon: Calendar   },
    { href: '/expenses-review/advances',        label: 'سلف الموظفين',     icon: CreditCard },
    { href: '/expenses-review/salaries',        label: 'مرتبات العاملين',  icon: Wallet     },
  ],
},
```

### 2.2 Pages & components

| Page | Path | What it does | Status |
|------|------|--------------|--------|
| HR Dashboard | `src/app/admin/hr/page.tsx` | Employees KPI, attendance panel, payroll/advances summary | Active |
| Attendance | `src/app/admin/attendance/page.tsx` | Mark check-in/out, status, bulk save | Active |
| Daily Payroll | `src/app/admin/attendance/daily-payroll/page.tsx` | Generate & post daily payroll to cash | Active |
| Employees (legacy) | `src/app/admin/employees/page.tsx` | Full employee CRUD + finance mapping | Active, duplicates HR |
| Tabbed Salaries | `src/app/expenses/salaries/page.tsx` | Payroll summary/settings/attendance/advances | Active, duplicates HR |
| Advances review | `src/app/expenses-review/advances/page.tsx` | Empty placeholder | Inactive |
| Salaries report | `src/app/expenses-review/salaries/page.tsx` | Empty placeholder | Inactive |
| Deductions register | `src/app/deductions/page.tsx` | Create deduction + history | Active |
| Monthly deductions | `src/app/reports/deductions/monthly/page.tsx` | Per-employee deductions summary | Active |
| Employee services | `src/app/admin/reports/employee-services/page.tsx` | Revenue used for commissions | Active |
| Employee monthly work | `src/app/admin/reports/employee-monthly-work-revenue/page.tsx` | Attendance + revenue per employee | Active |
| Monthly closing | `src/app/admin/monthly-closing/page.tsx` | Checklist incl. salary processing | Active |

---

## 3. Database Schema & Stored Procedures

### 3.1 Core tables

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `TblEmp` | Employee master | `EmpID`, `EmpName`, `Job`, `Salary`/`BaseSalary`, `SalaryType`, `DefaultCheckInTime`, `DefaultCheckOutTime`, `HourlyRate`, `IsPayrollEnabled`, `TargetCommissionPercent`, `TargetMinSales` |
| `TblEmpSalaryHistory` | Salary change audit | `EmpID`, `SalaryAmount`, `SalaryType`, `EffectiveFrom`, `EffectiveTo`, `IsActive` |
| `TblEmpAttendance` | Daily attendance | `ID`, `EmpID`, `WorkDate`, `CheckInTime`, `CheckOutTime`, `Status`, `Notes`, `CreatedAt`, `UpdatedAt` |
| `TblEmpDailyPayroll` | Daily payroll rows | `ID`, `EmpID`, `WorkDate`, `AttendanceID`, `SalaryHistoryID`, `HourlyRateSnapshot`, `ActualHours`, `DailyWage`, `Status`, `CashMoveID`, `EmployeeIncomeCashMoveID`, `Notes` |
| `TblExpCatEmpMap` | Employee ↔ category mapping | `ID`, `EmpID`, `ExpINID`, `TxnKind` (`advance`/`revenue`/`deduction`), `IsActive` |
| `TblExpINCat` | Expense/income categories | `ExpINID`, `CatName`, `ExpINType` (`مصروفات`/`ايرادات`) |
| `TblCashMove` | Cash movements | `ID`, `invID`, `invDate`, `invType`, `inOut`, `ExpINID`, `GrandTolal`, `ShiftMoveID`, `PaymentMethodID` |
| `TblShiftMove` | Shift records | `ShiftMoveID`, `UserID`, `DayID`, `OpenDate`, `CloseDate` |
| `TblPaymentMethods` | Payment methods | `ID`, `Name` |

### 3.2 Migrations that affect the schema

```@/Users/...casher/db/migrations/add-hourly-rate-to-tblemp.sql:1-92
ALTER TABLE dbo.TblEmp ADD HourlyRate DECIMAL(10,4) NULL;
CREATE TRIGGER dbo.trg_TblEmp_CalcHourlyRate
ON dbo.TblEmp
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT (UPDATE(Salary) OR UPDATE(BaseSalary) OR UPDATE(DefaultCheckInTime) OR UPDATE(DefaultCheckOutTime))
        RETURN;
    UPDATE e
    SET e.HourlyRate = CASE
        WHEN i.DefaultCheckInTime  IS NOT NULL
         AND i.DefaultCheckOutTime IS NOT NULL
         AND i.DefaultCheckOutTime > i.DefaultCheckInTime
         AND ISNULL(i.Salary, 0)  > 0
        THEN CAST(i.Salary AS DECIMAL(10,4))
             / NULLIF(
                 CAST(DATEDIFF(MINUTE, i.DefaultCheckInTime, i.DefaultCheckOutTime) AS DECIMAL(10,4)) / 60.0,
               0)
        ELSE NULL
    END
    FROM dbo.TblEmp e
    INNER JOIN inserted i ON i.EmpID = e.EmpID;
END;
```

```@/Users/...casher/db/migrations/add-actual-hours-to-daily-payroll.sql:1-55
IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'TblEmpDailyPayroll'
      AND COLUMN_NAME = 'ActualHours'
)
BEGIN
    ALTER TABLE dbo.TblEmpDailyPayroll
    ADD ActualHours DECIMAL(5, 2) NULL;
END;
```

### 3.3 Stored procedures

| SP | Called by | Purpose |
|----|-----------|---------|
| `dbo.sp_GetMonthlyPayroll` | `/api/payroll/monthly/route.ts` | Returns monthly payroll rows and summary |
| `dbo.sp_GetDailyPayroll` | Not found in current codebase | — |

Note: `sp_GetMonthlyPayroll` body is not in source; it is referenced in `sql/payroll-migration.sql`.

### 3.4 Triggers

- `trg_TblEmp_CalcHourlyRate` — keeps `HourlyRate` = `Salary / workHoursPerDay` current.

---

## 4. API Routes & Integration

### 4.1 Payroll routes

| Route | Method | Responsibility |
|-------|--------|----------------|
| `/api/payroll/monthly` | GET | Runs `sp_GetMonthlyPayroll` for date range; returns summary + rows |
| `/api/payroll/daily` | GET | Returns daily payroll rows + missing-revenue-mapping list for `workDate` |
| `/api/payroll/daily/generate` | POST | Validates attendance, inserts/updates `TblEmpDailyPayroll` rows |
| `/api/payroll/daily/post-to-cash` | POST | Creates expense/income `TblCashMove` rows for earned payroll |
| `/api/payroll/daily/auto-generate` | POST | Not reviewed in detail |
| `/api/payroll/daily/validate-attendance` | POST | Not reviewed in detail |
| `/api/payroll/employees/[empId]/salary-settings` | PUT | Updates `TblEmp`, manages `TblEmpSalaryHistory` |

### 4.2 Attendance routes

| Route | Method | Responsibility |
|-------|--------|----------------|
| `/api/admin/attendance` | GET/PUT | Attendance for one date + recalculation of late/early minutes |
| `/api/admin/attendance/bulk` | POST | Bulk update |
| `/api/employees/attendance` | GET/POST | Per-employee attendance range; MERGE upsert |

### 4.3 Deduction / advance routes

| Route | Method | Responsibility |
|-------|--------|----------------|
| `/api/deductions` | GET/POST | List deductions; create advance + settlement income pair |
| `/api/deductions/monthly-summary` | GET | **Broken** — SQL syntax error |
| `/api/reports/expenses/employee-advances` | GET | Advance totals vs revenue per employee |

### 4.4 Employee routes

| Route | Method | Responsibility |
|-------|--------|----------------|
| `/api/employees` | GET | Active/inactive employees with advance/revenue mapping columns |
| `/api/employees/[id]` | — | Not reviewed |
| `/api/admin/employees/[id]/finance-map` | PATCH/DELETE | Maps employee to advance/revenue categories |
| `/api/admin/employees/[id]/profile` | GET/PATCH | Full employee profile |
| `/api/admin/employees/[id]/schedule` | PUT | Weekly schedule |

### 4.5 Key integration patterns

- Daily payroll is posted to `TblCashMove` as an expense (`inOut='out'`) for the salon and an income (`inOut='in'`) for the employee, via the employee's revenue category mapping.
- Advances create the opposite: an expense out for the employee advance and an income in for settlement (see `/api/deductions/route.ts`).
- Both flows require an active `TblShiftMove` and a valid `TblNewDay` business day.

---

## 5. Frontend Components

### 5.1 Payroll components

| Component | Path | Used in |
|-----------|------|---------|
| `PayrollSummaryTab` | `src/components/payroll/PayrollSummaryTab.tsx` | `/expenses/salaries` |
| `PayrollSettingsTab` | `src/components/payroll/PayrollSettingsTab.tsx` | `/expenses/salaries` |
| `AttendanceTab` | `src/components/payroll/AttendanceTab.tsx` | `/expenses/salaries` |
| `AdvancesTab` | `src/components/payroll/AdvancesTab.tsx` | `/expenses/salaries` |

### 5.2 HR / attendance components

| Component | Path | Used in |
|-----------|------|---------|
| `AttendancePanel` | `src/components/hr/AttendancePanel.tsx` | `/admin/hr` |
| `EmployeeManagementModal` | `src/components/admin/EmployeeManagementModal.tsx` | `/admin/employees`, `/admin/hr` |
| `EmployeeAdvancesSection` | `src/components/reports/expenses/EmployeeAdvancesSection.tsx` | `/admin/hr` |

### 5.3 Shared utilities

- `src/lib/timeUtils.ts` — `calcLateMinutes`, `calcEarlyLeaveMinutes`, `parseTimeToMinutes`.
- `src/lib/businessDate.ts` — 4 AM business-date cutoff.

---

## 6. Business Logic & Rules

### 6.1 Daily payroll calculation

In `/api/payroll/daily/generate/route.ts`:

```@/Users/...casher/src/app/api/payroll/daily/generate/route.ts:1-204
const ACTUAL_HOURS_EXPR = `
  CASE
    WHEN a.CheckInTime IS NULL OR a.CheckOutTime IS NULL THEN NULL
    WHEN a.CheckOutTime > a.CheckInTime
      THEN CAST(DATEDIFF(MINUTE, a.CheckInTime, a.CheckOutTime) AS DECIMAL(10,2)) / 60.0
    WHEN a.CheckOutTime < a.CheckInTime
      THEN CAST(
        DATEDIFF(
          MINUTE,
          CAST(a.CheckInTime  AS DATETIME),
          DATEADD(DAY, 1, CAST(a.CheckOutTime AS DATETIME))
        ) AS DECIMAL(10,2)
      ) / 60.0
    ELSE 0
  END
`;
```

- Eligibility: `SalaryType = N'Daily'` and `IsPayrollEnabled = 1`.
- Exempt statuses: `إجازة`, `DayOff`, `Holiday`, `غائب`, `Absent`, `Leave`.
- Daily wage = `ActualHours * HourlyRateSnapshot`.
- Payroll rows transition: `Generated` → `Earned` → `PostedToCashMove`.

### 6.2 Attendance status & late/early rules

- `admin/attendance` route recalculates `LateMinutes` and `EarlyLeaveMinutes` based on scheduled vs actual times.
- Status can be auto-derived (`Present`, `Late`, `EarlyLeave`, `Absent`) or manually overridden.

### 6.3 Salary settings history

`/api/payroll/employees/[empId]/salary-settings/route.ts`:

- Closes previous active salary record (`EffectiveTo = today`, `IsActive = 0`).
- Inserts new record if wage changed.
- Sanitizes time inputs with `sanitizeTime`.

### 6.4 Advances / deductions

`/api/deductions/route.ts`:

- Requires active shift + business day.
- Finds employee's `advance` mapping in `TblExpCatEmpMap`.
- Creates matching income category named "معادلة" if missing.
- Inserts two `TblCashMove` rows within a `SERIALIZABLE` transaction.

---

## 7. Identified Issues & Risks

### 7.1 Critical — broken route

File: `src/app/api/deductions/monthly-summary/route.ts`

```@/Users/...casher/src/app/api/deductions/monthly-summary/route.ts:45
LEFT JOIN [dbo].[TblExpCatEmpMap map ON cm.ExpINID = map.ExpINID AND map.TxnKind = N\'advance\'
```

**Problem:** Missing closing `]` in table alias (`TblExpCatEmpMap map` should be `[TblExpCatEmpMap] map`). Same error on line 63.

**Impact:** `GET /api/deductions/monthly-summary` returns 500.

### 7.2 High — duplicate / placeholder pages

| Duplicate | Canonical location | Risk |
|-----------|-------------------|------|
| `/admin/employees` | `/admin/hr` | Two employee management UIs to maintain |
| `/expenses/salaries` | `/admin/hr` + `/admin/attendance/daily-payroll` | Same tabs exist inside HR dashboard |
| `/expenses-review/advances` | `/deductions` + HR dashboard | Empty placeholder |
| `/expenses-review/salaries` | `/admin/attendance/daily-payroll` | Empty placeholder |

### 7.3 Medium — page registry gaps

`src/lib/pages-registry.ts` does not contain:
- `/admin/employees`
- `/admin/attendance/daily-payroll`
- `/expenses/salaries`

These pages are reachable via navigation but may be skipped by the permission-sync seeder.

### 7.4 Medium — payroll data model gaps

- `TblEmpDailyPayroll` does not store `LateMinutes`, `EarlyLeaveMinutes`, or penalty fields.
- `sp_GetMonthlyPayroll` source is not in the repo; behavior is opaque.
- No visible handling of paid days-off vs unpaid days-off.

### 7.5 Low — hardcoded Arabic category names

`/api/deductions/route.ts` and `/api/deductions/monthly-summary/route.ts` filter by `CatName LIKE N'%سلف%'` and create a literal "معادلة" category. Renaming categories in the UI could break matching.

---

## 8. Recommendations & Next Steps

### 8.1 Immediate fixes

1. **Fix SQL syntax** in `src/app/api/deductions/monthly-summary/route.ts` (lines 45 and 63).
2. **Add missing pages** to `SYSTEM_PAGES` in `src/lib/pages-registry.ts` or remove the pages.
3. **Register `/admin/attendance/daily-payroll`** for permission sync.

### 8.2 Consolidation

- Remove `/admin/employees` and redirect to `/admin/hr`.
- Remove `/expenses/salaries` and redirect to `/admin/hr`.
- Remove `/expenses-review/advances` and `/expenses-review/salaries` placeholders or replace them with real reports.

### 8.3 Enhancements

- Extend `TblEmpDailyPayroll` to store `LateMinutes`, `EarlyLeaveMinutes`, and a `LatePenalty` / `EarlyLeavePenalty` if needed.
- Add a unit/regression test for the `ACTUAL_HOURS_EXPR` midnight-crossover logic.
- Source-control `sp_GetMonthlyPayroll` or document its output columns.
- Replace Arabic string matching in deduction logic with `TblExpCatEmpMap.TxnKind = 'advance'`.

### 8.4 Verification commands

After fixes, test the broken route:

```bash
# should return JSON, not 500
curl "http://localhost:3000/api/deductions/monthly-summary?month=2025-06"
```

Run the project TypeScript check:

```bash
npm run type-check
```

If a test suite exists for payroll, run:

```bash
npm test -- payroll
```

---

## 9. Appendix — File Paths Index

| Concern | Files |
|---------|-------|
| Navigation | `src/components/layout/nav-config.ts`, `src/lib/pages-registry.ts` |
| HR Dashboard | `src/app/admin/hr/page.tsx` |
| Attendance | `src/app/admin/attendance/page.tsx`, `src/app/api/admin/attendance/route.ts`, `src/components/hr/AttendancePanel.tsx` |
| Daily Payroll | `src/app/admin/attendance/daily-payroll/page.tsx`, `src/app/api/payroll/daily/generate/route.ts`, `src/app/api/payroll/daily/post-to-cash/route.ts`, `src/app/api/payroll/daily/route.ts` |
| Monthly Payroll | `src/app/api/payroll/monthly/route.ts`, `src/components/payroll/PayrollSummaryTab.tsx` |
| Salary Settings | `src/components/payroll/PayrollSettingsTab.tsx`, `src/app/api/payroll/employees/[empId]/salary-settings/route.ts` |
| Deductions | `src/app/deductions/page.tsx`, `src/app/api/deductions/route.ts`, `src/app/api/deductions/monthly-summary/route.ts`, `src/components/deductions/MonthlySummary.tsx` |
| Advances Reports | `src/app/api/reports/expenses/employee-advances/route.ts`, `src/components/reports/expenses/EmployeeAdvancesSection.tsx` |
| Employees | `src/app/admin/employees/page.tsx`, `src/components/admin/EmployeeManagementModal.tsx`, `src/app/api/employees/route.ts`, `src/app/api/admin/employees/[id]/finance-map/route.ts` |
| Migrations | `db/migrations/add-hourly-rate-to-tblemp.sql`, `db/migrations/add-actual-hours-to-daily-payroll.sql`, `db/migrations/create-tbl-exp-cat-emp-map.sql`, `sql/payroll-migration.sql` |

---

*End of report*

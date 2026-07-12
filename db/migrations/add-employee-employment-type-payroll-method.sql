-- ============================================================
-- Migration: EmploymentType + PayrollMethod (Phase 1)
-- Safe idempotent — adds nullable columns, CHECK constraints,
-- and backfills existing employees without changing runtime behavior.
--
-- NOTE: TblEmp.HourlyRate is maintained by trg_TblEmp_CalcHourlyRate
-- (Salary / same-day work hours). Overnight DefaultCheckOutTime <
-- DefaultCheckInTime yields NULL HourlyRate. ManualHourlyRate is
-- introduced for later phases; payroll logic still uses HourlyRate.
-- Do NOT alter the trigger in Phase 1.
-- ============================================================
SET NOCOUNT ON;
PRINT N'============================================================';
PRINT N' add-employee-employment-type-payroll-method.sql START '
  + CONVERT(NVARCHAR, GETDATE(), 120);
PRINT N'============================================================';

-- ── 1. Add columns (idempotent) ───────────────────────────────────────────

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'TblEmp'
      AND COLUMN_NAME = N'EmploymentType'
)
BEGIN
    ALTER TABLE dbo.TblEmp ADD EmploymentType NVARCHAR(20) NULL;
    PRINT N'  [+] Added EmploymentType';
END
ELSE PRINT N'  [=] EmploymentType already exists';

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'TblEmp'
      AND COLUMN_NAME = N'PayrollMethod'
)
BEGIN
    ALTER TABLE dbo.TblEmp ADD PayrollMethod NVARCHAR(20) NULL;
    PRINT N'  [+] Added PayrollMethod';
END
ELSE PRINT N'  [=] PayrollMethod already exists';

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'TblEmp'
      AND COLUMN_NAME = N'DailyRate'
)
BEGIN
    ALTER TABLE dbo.TblEmp ADD DailyRate DECIMAL(10, 2) NULL;
    PRINT N'  [+] Added DailyRate';
END
ELSE PRINT N'  [=] DailyRate already exists';

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'TblEmp'
      AND COLUMN_NAME = N'ManualHourlyRate'
)
BEGIN
    ALTER TABLE dbo.TblEmp ADD ManualHourlyRate DECIMAL(10, 4) NULL;
    PRINT N'  [+] Added ManualHourlyRate';
END
ELSE PRINT N'  [=] ManualHourlyRate already exists';

GO

-- ── 2. CHECK constraints (idempotent) ───────────────────────────────────────

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_TblEmp_EmploymentType'
      AND parent_object_id = OBJECT_ID(N'dbo.TblEmp')
)
BEGIN
    ALTER TABLE dbo.TblEmp WITH CHECK ADD CONSTRAINT CK_TblEmp_EmploymentType
        CHECK (EmploymentType IS NULL OR EmploymentType IN (
            N'full_time', N'part_time', N'freelance'
        ));
    PRINT N'  [+] Added CK_TblEmp_EmploymentType';
END
ELSE PRINT N'  [=] CK_TblEmp_EmploymentType already exists';

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_TblEmp_PayrollMethod'
      AND parent_object_id = OBJECT_ID(N'dbo.TblEmp')
)
BEGIN
    ALTER TABLE dbo.TblEmp WITH CHECK ADD CONSTRAINT CK_TblEmp_PayrollMethod
        CHECK (PayrollMethod IS NULL OR PayrollMethod IN (
            N'hourly', N'daily', N'monthly'
        ));
    PRINT N'  [+] Added CK_TblEmp_PayrollMethod';
END
ELSE PRINT N'  [=] CK_TblEmp_PayrollMethod already exists';

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_TblEmp_Freelance_NoMonthly'
      AND parent_object_id = OBJECT_ID(N'dbo.TblEmp')
)
BEGIN
    ALTER TABLE dbo.TblEmp WITH CHECK ADD CONSTRAINT CK_TblEmp_Freelance_NoMonthly
        CHECK (NOT (EmploymentType = N'freelance' AND PayrollMethod = N'monthly'));
    PRINT N'  [+] Added CK_TblEmp_Freelance_NoMonthly';
END
ELSE PRINT N'  [=] CK_TblEmp_Freelance_NoMonthly already exists';

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_TblEmp_DailyRate_NonNegative'
      AND parent_object_id = OBJECT_ID(N'dbo.TblEmp')
)
BEGIN
    ALTER TABLE dbo.TblEmp WITH CHECK ADD CONSTRAINT CK_TblEmp_DailyRate_NonNegative
        CHECK (DailyRate IS NULL OR DailyRate >= 0);
    PRINT N'  [+] Added CK_TblEmp_DailyRate_NonNegative';
END
ELSE PRINT N'  [=] CK_TblEmp_DailyRate_NonNegative already exists';

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_TblEmp_ManualHourlyRate_NonNegative'
      AND parent_object_id = OBJECT_ID(N'dbo.TblEmp')
)
BEGIN
    ALTER TABLE dbo.TblEmp WITH CHECK ADD CONSTRAINT CK_TblEmp_ManualHourlyRate_NonNegative
        CHECK (ManualHourlyRate IS NULL OR ManualHourlyRate >= 0);
    PRINT N'  [+] Added CK_TblEmp_ManualHourlyRate_NonNegative';
END
ELSE PRINT N'  [=] CK_TblEmp_ManualHourlyRate_NonNegative already exists';

GO

-- ── 3. Backfill (only NULL targets — safe to re-run) ───────────────────────

PRINT N'--- Backfill EmploymentType ---';

DECLARE @HasIsAttendanceExempt BIT = CASE
    WHEN EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'TblEmp'
          AND COLUMN_NAME = N'IsAttendanceExempt'
    ) THEN 1 ELSE 0
END;

IF @HasIsAttendanceExempt = 1
BEGIN
    IF OBJECT_ID(N'dbo.TblEmpWorkSchedule', N'U') IS NOT NULL
    BEGIN
        UPDATE e
        SET e.EmploymentType = mapped.NewType
        FROM dbo.TblEmp e
        INNER JOIN (
            SELECT
                e2.EmpID,
                CASE
                    WHEN ISNULL(e2.IsAttendanceExempt, 0) = 1 THEN N'freelance'
                    WHEN wd.WorkingDays = 6 THEN N'full_time'
                    WHEN wd.WorkingDays BETWEEN 1 AND 5 THEN N'part_time'
                    ELSE N'full_time'
                END AS NewType
            FROM dbo.TblEmp e2
            LEFT JOIN (
                SELECT
                    EmpID,
                    SUM(CASE WHEN IsWorkingDay = 1 THEN 1 ELSE 0 END) AS WorkingDays
                FROM dbo.TblEmpWorkSchedule
                GROUP BY EmpID
            ) wd ON wd.EmpID = e2.EmpID
            WHERE e2.EmploymentType IS NULL
        ) mapped ON mapped.EmpID = e.EmpID
        WHERE e.EmploymentType IS NULL;
    END
    ELSE
    BEGIN
        UPDATE dbo.TblEmp
        SET EmploymentType = CASE
            WHEN ISNULL(IsAttendanceExempt, 0) = 1 THEN N'freelance'
            ELSE N'full_time'
        END
        WHERE EmploymentType IS NULL;
    END
END
ELSE
BEGIN
    IF OBJECT_ID(N'dbo.TblEmpWorkSchedule', N'U') IS NOT NULL
    BEGIN
        UPDATE e
        SET e.EmploymentType = mapped.NewType
        FROM dbo.TblEmp e
        INNER JOIN (
            SELECT
                e2.EmpID,
                CASE
                    WHEN wd.WorkingDays = 6 THEN N'full_time'
                    WHEN wd.WorkingDays BETWEEN 1 AND 5 THEN N'part_time'
                    ELSE N'full_time'
                END AS NewType
            FROM dbo.TblEmp e2
            LEFT JOIN (
                SELECT
                    EmpID,
                    SUM(CASE WHEN IsWorkingDay = 1 THEN 1 ELSE 0 END) AS WorkingDays
                FROM dbo.TblEmpWorkSchedule
                GROUP BY EmpID
            ) wd ON wd.EmpID = e2.EmpID
            WHERE e2.EmploymentType IS NULL
        ) mapped ON mapped.EmpID = e.EmpID
        WHERE e.EmploymentType IS NULL;
    END
    ELSE
    BEGIN
        UPDATE dbo.TblEmp
        SET EmploymentType = N'full_time'
        WHERE EmploymentType IS NULL;
    END
END;

PRINT N'  [~] EmploymentType backfill rows: ' + CAST(@@ROWCOUNT AS NVARCHAR);

PRINT N'--- Backfill PayrollMethod ---';

UPDATE dbo.TblEmp
SET PayrollMethod = CASE
    WHEN LOWER(LTRIM(RTRIM(ISNULL(SalaryType, N'')))) = N'monthly' THEN N'monthly'
    WHEN LOWER(LTRIM(RTRIM(ISNULL(SalaryType, N'')))) = N'daily'   THEN N'hourly'
    WHEN LOWER(LTRIM(RTRIM(ISNULL(SalaryType, N'')))) = N'hourly'  THEN N'hourly'
    ELSE N'hourly'
END
WHERE PayrollMethod IS NULL;

PRINT N'  [~] PayrollMethod backfill rows: ' + CAST(@@ROWCOUNT AS NVARCHAR);

PRINT N'--- Backfill DailyRate from Salary ---';

UPDATE dbo.TblEmp
SET DailyRate = Salary
WHERE DailyRate IS NULL
  AND Salary IS NOT NULL
  AND Salary > 0;

PRINT N'  [~] DailyRate backfill rows: ' + CAST(@@ROWCOUNT AS NVARCHAR);

PRINT N'--- Backfill ManualHourlyRate from HourlyRate ---';

UPDATE dbo.TblEmp
SET ManualHourlyRate = HourlyRate
WHERE ManualHourlyRate IS NULL
  AND HourlyRate IS NOT NULL
  AND HourlyRate > 0;

PRINT N'  [~] ManualHourlyRate backfill rows: ' + CAST(@@ROWCOUNT AS NVARCHAR);

GO

-- ── 4. Post-backfill validation report (read-only diagnostics) ──────────────

PRINT N'--- Post-migration summary ---';

SELECT
    ISNULL(EmploymentType, N'NULL') AS EmploymentType,
    COUNT(*) AS EmployeeCount
FROM dbo.TblEmp
GROUP BY EmploymentType
ORDER BY EmploymentType;

SELECT
    ISNULL(PayrollMethod, N'NULL') AS PayrollMethod,
    COUNT(*) AS EmployeeCount
FROM dbo.TblEmp
GROUP BY PayrollMethod
ORDER BY PayrollMethod;

SELECT EmpID, EmpName, EmploymentType, PayrollMethod
FROM dbo.TblEmp
WHERE EmploymentType IS NULL OR PayrollMethod IS NULL
ORDER BY EmpName;

SELECT EmpID, EmpName, EmploymentType, PayrollMethod
FROM dbo.TblEmp
WHERE EmploymentType = N'freelance' AND PayrollMethod = N'monthly';

PRINT N'============================================================';
PRINT N' add-employee-employment-type-payroll-method.sql COMPLETE '
  + CONVERT(NVARCHAR, GETDATE(), 120);
PRINT N'============================================================';

GO

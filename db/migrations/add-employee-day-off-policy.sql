-- ============================================================
-- Migration: DayOffPolicy (HR model extension)
-- Safe idempotent — adds nullable column, CHECK constraint,
-- and backfills from EmploymentType + schedule working-day count.
-- ============================================================
SET NOCOUNT ON;
PRINT N'============================================================';
PRINT N' add-employee-day-off-policy.sql START '
  + CONVERT(NVARCHAR, GETDATE(), 120);
PRINT N'============================================================';

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'TblEmp'
      AND COLUMN_NAME = N'DayOffPolicy'
)
BEGIN
    ALTER TABLE dbo.TblEmp ADD DayOffPolicy NVARCHAR(20) NULL;
    PRINT N'  [+] Added DayOffPolicy';
END
ELSE PRINT N'  [=] DayOffPolicy already exists';

GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_TblEmp_DayOffPolicy'
      AND parent_object_id = OBJECT_ID(N'dbo.TblEmp')
)
BEGIN
    ALTER TABLE dbo.TblEmp WITH CHECK ADD CONSTRAINT CK_TblEmp_DayOffPolicy
        CHECK (DayOffPolicy IS NULL OR DayOffPolicy IN (
            N'fixed_weekly', N'flexible_weekly', N'none'
        ));
    PRINT N'  [+] Added CK_TblEmp_DayOffPolicy';
END
ELSE PRINT N'  [=] CK_TblEmp_DayOffPolicy already exists';

GO

PRINT N'--- Backfill DayOffPolicy ---';

IF OBJECT_ID(N'dbo.TblEmpWorkSchedule', N'U') IS NOT NULL
BEGIN
    UPDATE e
    SET e.DayOffPolicy = mapped.NewPolicy
    FROM dbo.TblEmp e
    INNER JOIN (
        SELECT
            e2.EmpID,
            CASE
                WHEN e2.EmploymentType = N'freelance' THEN N'none'
                WHEN e2.EmploymentType = N'part_time' THEN N'none'
                WHEN e2.EmploymentType = N'full_time' AND wd.WorkingDays = 6 THEN N'fixed_weekly'
                WHEN e2.EmploymentType = N'full_time' AND wd.WorkingDays = 7 THEN N'flexible_weekly'
                WHEN e2.EmploymentType = N'full_time' THEN N'fixed_weekly'
                ELSE N'none'
            END AS NewPolicy
        FROM dbo.TblEmp e2
        LEFT JOIN (
            SELECT
                EmpID,
                SUM(CASE WHEN IsWorkingDay = 1 THEN 1 ELSE 0 END) AS WorkingDays
            FROM dbo.TblEmpWorkSchedule
            GROUP BY EmpID
        ) wd ON wd.EmpID = e2.EmpID
        WHERE e2.DayOffPolicy IS NULL
    ) mapped ON mapped.EmpID = e.EmpID
    WHERE e.DayOffPolicy IS NULL;
END
ELSE
BEGIN
    UPDATE dbo.TblEmp
    SET DayOffPolicy = CASE
        WHEN EmploymentType = N'freelance' THEN N'none'
        WHEN EmploymentType = N'part_time' THEN N'none'
        WHEN EmploymentType = N'full_time' THEN N'fixed_weekly'
        ELSE N'none'
    END
    WHERE DayOffPolicy IS NULL;
END;

PRINT N'  [~] DayOffPolicy backfill rows: ' + CAST(@@ROWCOUNT AS NVARCHAR);

GO

PRINT N'--- Post-migration summary ---';

SELECT
    ISNULL(DayOffPolicy, N'NULL') AS DayOffPolicy,
    COUNT(*) AS EmployeeCount
FROM dbo.TblEmp
GROUP BY DayOffPolicy
ORDER BY DayOffPolicy;

SELECT EmpID, EmpName, EmploymentType, DayOffPolicy
FROM dbo.TblEmp
WHERE EmploymentType = N'full_time' AND DayOffPolicy IS NULL
ORDER BY EmpName;

PRINT N'============================================================';
PRINT N' add-employee-day-off-policy.sql COMPLETE '
  + CONVERT(NVARCHAR, GETDATE(), 120);
PRINT N'============================================================';

GO

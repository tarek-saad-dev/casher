-- ============================================================
-- Phase 1K: Branch-owned attendance sessions
-- Adds BranchID to TblEmpAttendance, backfills GLEEM,
-- replaces global Emp+WorkDate uniqueness with Branch+Emp+WorkDate.
-- Open-session exclusivity enforced in application (applock) —
-- historical multi-open incompletes prevent a filtered unique index.
-- Does NOT add BranchID to payroll/ledger/target tables.
-- Idempotent. cloud / last132 only.
-- ============================================================
SET NOCOUNT ON;
GO

IF DB_NAME() <> N'last132'
BEGIN
    RAISERROR(N'Phase 1K migration requires database last132', 16, 1);
END;
GO

DECLARE @GleemBranchID INT =
    (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM');
IF @GleemBranchID IS NULL
BEGIN
    RAISERROR(N'Phase 1K requires founding branch GLEEM', 16, 1);
END;
IF NOT EXISTS (
    SELECT 1 FROM dbo.TblBranch WHERE BranchCode = N'GLEEM' AND IsActive = 1
)
BEGIN
    RAISERROR(N'GLEEM must be active for Phase 1K', 16, 1);
END;
PRINT CONCAT(N'Phase 1K GLEEM BranchID=', @GleemBranchID);
GO

------------------------------------------------------------
-- 1) Add BranchID nullable
------------------------------------------------------------
IF COL_LENGTH(N'dbo.TblEmpAttendance', N'BranchID') IS NULL
BEGIN
    ALTER TABLE dbo.TblEmpAttendance ADD BranchID INT NULL;
    PRINT N'Added TblEmpAttendance.BranchID (nullable)';
END
GO

------------------------------------------------------------
-- 2) Backfill all NULL BranchID → GLEEM
------------------------------------------------------------
DECLARE @GleemBranchID INT =
    (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM');

UPDATE dbo.TblEmpAttendance
SET BranchID = @GleemBranchID
WHERE BranchID IS NULL;

IF EXISTS (SELECT 1 FROM dbo.TblEmpAttendance WHERE BranchID IS NULL)
BEGIN
    RAISERROR(N'TblEmpAttendance.BranchID still null after GLEEM backfill', 16, 1);
END;

PRINT CONCAT(N'Backfilled attendance BranchID to GLEEM; rows=', @@ROWCOUNT);
GO

------------------------------------------------------------
-- 3) FK
------------------------------------------------------------
IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblEmpAttendance_BranchID'
)
BEGIN
    ALTER TABLE dbo.TblEmpAttendance
        ADD CONSTRAINT FK_TblEmpAttendance_BranchID
        FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch (BranchID);
    PRINT N'Created FK_TblEmpAttendance_BranchID';
END
GO

------------------------------------------------------------
-- 4) NOT NULL
------------------------------------------------------------
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.TblEmpAttendance')
      AND name = N'BranchID'
      AND is_nullable = 1
)
BEGIN
    ALTER TABLE dbo.TblEmpAttendance ALTER COLUMN BranchID INT NOT NULL;
    PRINT N'TblEmpAttendance.BranchID set NOT NULL';
END
GO

------------------------------------------------------------
-- 5) Replace unique Emp+WorkDate → Branch+Emp+WorkDate
------------------------------------------------------------
IF EXISTS (
    SELECT 1 FROM sys.key_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.TblEmpAttendance')
      AND name = N'UQ_TblEmpAttendance_Emp_WorkDate'
)
BEGIN
    ALTER TABLE dbo.TblEmpAttendance DROP CONSTRAINT UQ_TblEmpAttendance_Emp_WorkDate;
    PRINT N'Dropped constraint UQ_TblEmpAttendance_Emp_WorkDate';
END
ELSE IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.TblEmpAttendance')
      AND name = N'UQ_TblEmpAttendance_Emp_WorkDate'
)
BEGIN
    DROP INDEX UQ_TblEmpAttendance_Emp_WorkDate ON dbo.TblEmpAttendance;
    PRINT N'Dropped index UQ_TblEmpAttendance_Emp_WorkDate';
END
GO

-- Legacy alternate name from some creates
IF EXISTS (
    SELECT 1 FROM sys.key_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.TblEmpAttendance')
      AND name = N'UQ_TblEmpAttendance_Emp_Date'
)
BEGIN
    ALTER TABLE dbo.TblEmpAttendance DROP CONSTRAINT UQ_TblEmpAttendance_Emp_Date;
    PRINT N'Dropped constraint UQ_TblEmpAttendance_Emp_Date';
END
ELSE IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.TblEmpAttendance')
      AND name = N'UQ_TblEmpAttendance_Emp_Date'
)
BEGIN
    DROP INDEX UQ_TblEmpAttendance_Emp_Date ON dbo.TblEmpAttendance;
    PRINT N'Dropped index UQ_TblEmpAttendance_Emp_Date';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.TblEmpAttendance')
      AND name = N'UQ_TblEmpAttendance_Branch_Emp_WorkDate'
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UQ_TblEmpAttendance_Branch_Emp_WorkDate
        ON dbo.TblEmpAttendance (BranchID, EmpID, WorkDate);
    PRINT N'Created UQ_TblEmpAttendance_Branch_Emp_WorkDate';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.TblEmpAttendance')
      AND name = N'IX_TblEmpAttendance_Branch_WorkDate'
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_TblEmpAttendance_Branch_WorkDate
        ON dbo.TblEmpAttendance (BranchID, WorkDate)
        INCLUDE (EmpID, Status, CheckInTime, CheckOutTime);
    PRINT N'Created IX_TblEmpAttendance_Branch_WorkDate';
END
GO

------------------------------------------------------------
-- 6) Compatibility view: employee/day aggregate for payroll
------------------------------------------------------------
IF OBJECT_ID(N'dbo.vw_EmpAttendancePayrollDay', N'V') IS NOT NULL
    DROP VIEW dbo.vw_EmpAttendancePayrollDay;
GO

CREATE VIEW dbo.vw_EmpAttendancePayrollDay
AS
SELECT
    a.EmpID,
    a.WorkDate,
    MIN(a.ID) AS PrimaryAttendanceID,
    COUNT(*) AS SessionCount,
    SUM(
        CASE
            WHEN a.CheckInTime IS NULL OR a.CheckOutTime IS NULL THEN CAST(0 AS DECIMAL(18, 4))
            WHEN a.CheckOutTime > a.CheckInTime
                THEN CAST(DATEDIFF(MINUTE, a.CheckInTime, a.CheckOutTime) AS DECIMAL(18, 4))
            WHEN a.CheckOutTime < a.CheckInTime
                THEN CAST(
                    DATEDIFF(
                        MINUTE,
                        CAST(a.CheckInTime AS DATETIME),
                        DATEADD(DAY, 1, CAST(a.CheckOutTime AS DATETIME))
                    ) AS DECIMAL(18, 4)
                )
            ELSE CAST(0 AS DECIMAL(18, 4))
        END
        - CAST(ISNULL(a.BreakMinutesTotal, 0) AS DECIMAL(18, 4))
    ) AS NetMinutesRaw,
    SUM(ISNULL(a.BreakMinutesTotal, 0)) AS BreakMinutesTotal,
    CAST(MAX(CASE WHEN a.CheckInTime IS NOT NULL AND a.CheckOutTime IS NULL THEN 1 ELSE 0 END) AS BIT) AS HasOpenSession,
    CAST(MAX(CASE WHEN a.CheckInTime IS NOT NULL THEN 1 ELSE 0 END) AS BIT) AS HasAnyCheckIn,
    CAST(MAX(CASE WHEN a.CheckInTime IS NULL THEN 1 ELSE 0 END) AS BIT) AS HasMissingCheckIn,
    MAX(a.Status) AS AnyStatus
FROM dbo.TblEmpAttendance a
GROUP BY a.EmpID, a.WorkDate;
GO

PRINT N'Created vw_EmpAttendancePayrollDay';
GO

------------------------------------------------------------
-- 7) Sanity: no PH1GTEST attendance; counts preserved on GLEEM
------------------------------------------------------------
IF EXISTS (
    SELECT 1
    FROM dbo.TblEmpAttendance a
    INNER JOIN dbo.TblBranch b ON b.BranchID = a.BranchID
    WHERE b.BranchCode = N'PH1GTEST'
)
BEGIN
    RAISERROR(N'Phase 1K abort: PH1GTEST must not own attendance rows', 16, 1);
END
GO

PRINT N'Phase 1K migration completed';
GO

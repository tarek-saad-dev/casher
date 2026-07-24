-- ============================================================
-- Phase 1L: Branch-owned employee payroll, ledger, targets
-- Employee identity remains global; financial accounts are EmpID+BranchID.
-- Global balance = read-only SUM of branch accounts.
-- Idempotent. cloud / last132 only.
-- Does NOT activate PH1GTEST or duplicate TblEmp.
-- ============================================================
SET NOCOUNT ON;
GO

IF DB_NAME() <> N'last132'
BEGIN
    RAISERROR(N'Phase 1L migration requires database last132', 16, 1);
END;
GO

DECLARE @GleemBranchID INT =
    (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM');
IF @GleemBranchID IS NULL
BEGIN
    RAISERROR(N'Phase 1L requires founding branch GLEEM', 16, 1);
END;
IF NOT EXISTS (
    SELECT 1 FROM dbo.TblBranch WHERE BranchCode = N'GLEEM' AND IsActive = 1
)
BEGIN
    RAISERROR(N'GLEEM must be active for Phase 1L', 16, 1);
END;
IF EXISTS (
    SELECT 1 FROM dbo.TblBranch WHERE BranchCode = N'PH1GTEST' AND IsActive = 1
)
BEGIN
    RAISERROR(N'PH1GTEST must remain inactive for Phase 1L', 16, 1);
END;
PRINT CONCAT(N'Phase 1L GLEEM BranchID=', @GleemBranchID);
GO

------------------------------------------------------------
-- 1) Branch payroll plan (effective-dated compensation per branch)
------------------------------------------------------------
IF OBJECT_ID(N'dbo.TblEmpBranchPayrollPlan', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TblEmpBranchPayrollPlan (
        PlanID INT IDENTITY(1,1) NOT NULL,
        EmpID INT NOT NULL,
        BranchID INT NOT NULL,
        PayType NVARCHAR(20) NOT NULL,
        HourlyRate DECIMAL(12, 4) NULL,
        DailyRate DECIMAL(12, 4) NULL,
        MonthlySalary DECIMAL(12, 2) NULL,
        EffectiveFrom DATE NOT NULL,
        EffectiveTo DATE NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_TblEmpBranchPayrollPlan_IsActive DEFAULT (1),
        SourceNotes NVARCHAR(200) NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_TblEmpBranchPayrollPlan_CreatedAt DEFAULT (SYSDATETIME()),
        UpdatedAt DATETIME2(0) NULL,
        CONSTRAINT PK_TblEmpBranchPayrollPlan PRIMARY KEY CLUSTERED (PlanID),
        CONSTRAINT FK_TblEmpBranchPayrollPlan_Emp FOREIGN KEY (EmpID) REFERENCES dbo.TblEmp (EmpID),
        CONSTRAINT FK_TblEmpBranchPayrollPlan_Branch FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch (BranchID),
        CONSTRAINT CK_TblEmpBranchPayrollPlan_PayType CHECK (
            PayType IN (N'hourly', N'daily', N'monthly')
        ),
        CONSTRAINT CK_TblEmpBranchPayrollPlan_Effective CHECK (
            EffectiveTo IS NULL OR EffectiveTo >= EffectiveFrom
        )
    );
    CREATE UNIQUE NONCLUSTERED INDEX UX_TblEmpBranchPayrollPlan_Emp_Branch_From
        ON dbo.TblEmpBranchPayrollPlan (EmpID, BranchID, EffectiveFrom);
    CREATE NONCLUSTERED INDEX IX_TblEmpBranchPayrollPlan_Branch_Active
        ON dbo.TblEmpBranchPayrollPlan (BranchID, IsActive, EffectiveFrom)
        INCLUDE (EmpID, PayType, HourlyRate, DailyRate, MonthlySalary, EffectiveTo);
    PRINT N'Created TblEmpBranchPayrollPlan';
END
GO

-- Seed GLEEM plans from current employee compensation (idempotent by Emp+Branch+From)
DECLARE @GleemBranchID INT =
    (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM');

;WITH src AS (
    SELECT
        e.EmpID,
        @GleemBranchID AS BranchID,
        CASE
            WHEN e.PayrollMethod IN (N'hourly', N'daily', N'monthly') THEN e.PayrollMethod
            WHEN e.SalaryType = N'monthly' THEN N'monthly'
            ELSE N'hourly'
        END AS PayType,
        CAST(COALESCE(e.ManualHourlyRate, e.HourlyRate, h.SalaryAmount) AS DECIMAL(12, 4)) AS HourlyRate,
        CAST(e.DailyRate AS DECIMAL(12, 4)) AS DailyRate,
        CAST(COALESCE(e.BaseSalary, CASE WHEN e.SalaryType = N'monthly' OR e.PayrollMethod = N'monthly' THEN e.Salary END) AS DECIMAL(12, 2)) AS MonthlySalary,
        CAST(COALESCE(h.EffectiveFrom, '2020-01-01') AS DATE) AS EffectiveFrom
    FROM dbo.TblEmp e
    OUTER APPLY (
        SELECT TOP 1 sh.SalaryAmount, sh.EffectiveFrom, sh.SalaryType
        FROM dbo.TblEmpSalaryHistory sh
        WHERE sh.EmpID = e.EmpID AND sh.IsActive = 1 AND sh.EffectiveTo IS NULL
        ORDER BY sh.EffectiveFrom DESC, sh.ID DESC
    ) h
    WHERE ISNULL(e.isActive, 1) = 1
)
INSERT INTO dbo.TblEmpBranchPayrollPlan (
    EmpID, BranchID, PayType, HourlyRate, DailyRate, MonthlySalary,
    EffectiveFrom, EffectiveTo, IsActive, SourceNotes
)
SELECT
    s.EmpID, s.BranchID, s.PayType, s.HourlyRate, s.DailyRate, s.MonthlySalary,
    s.EffectiveFrom, NULL, 1, N'Phase1L backfill from TblEmp/SalaryHistory → GLEEM'
FROM src s
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.TblEmpBranchPayrollPlan p
    WHERE p.EmpID = s.EmpID AND p.BranchID = s.BranchID AND p.EffectiveFrom = s.EffectiveFrom
);
PRINT CONCAT(N'Seeded GLEEM payroll plans; inserted=', @@ROWCOUNT);
GO

------------------------------------------------------------
-- 2) Add nullable BranchID columns
------------------------------------------------------------
IF COL_LENGTH(N'dbo.TblEmpDailyPayroll', N'BranchID') IS NULL
BEGIN
    ALTER TABLE dbo.TblEmpDailyPayroll ADD BranchID INT NULL;
    PRINT N'Added TblEmpDailyPayroll.BranchID';
END
GO

IF COL_LENGTH(N'dbo.TblEmpLedgerEntry', N'BranchID') IS NULL
BEGIN
    ALTER TABLE dbo.TblEmpLedgerEntry ADD BranchID INT NULL;
    PRINT N'Added TblEmpLedgerEntry.BranchID';
END
GO

IF COL_LENGTH(N'dbo.TblEmpDailyTarget', N'BranchID') IS NULL
BEGIN
    ALTER TABLE dbo.TblEmpDailyTarget ADD BranchID INT NULL;
    PRINT N'Added TblEmpDailyTarget.BranchID';
END
GO

IF COL_LENGTH(N'dbo.TblEmpTargetRecalcRequest', N'BranchID') IS NULL
BEGIN
    ALTER TABLE dbo.TblEmpTargetRecalcRequest ADD BranchID INT NULL;
    PRINT N'Added TblEmpTargetRecalcRequest.BranchID';
END
GO

IF COL_LENGTH(N'dbo.TblEmpTargetPlan', N'BranchID') IS NULL
BEGIN
    ALTER TABLE dbo.TblEmpTargetPlan ADD BranchID INT NULL;
    PRINT N'Added TblEmpTargetPlan.BranchID';
END
GO

------------------------------------------------------------
-- 3) Backfill BranchID
------------------------------------------------------------
DECLARE @GleemBranchID INT =
    (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM');

-- Daily payroll: from attendance when available, else GLEEM
UPDATE p
SET p.BranchID = COALESCE(a.BranchID, @GleemBranchID)
FROM dbo.TblEmpDailyPayroll p
LEFT JOIN dbo.TblEmpAttendance a ON a.ID = p.AttendanceID
WHERE p.BranchID IS NULL;

UPDATE dbo.TblEmpDailyPayroll
SET BranchID = @GleemBranchID
WHERE BranchID IS NULL;

-- Targets + plans + recalc → GLEEM (sole historical operating branch)
UPDATE dbo.TblEmpDailyTarget SET BranchID = @GleemBranchID WHERE BranchID IS NULL;
UPDATE dbo.TblEmpTargetPlan SET BranchID = @GleemBranchID WHERE BranchID IS NULL;
UPDATE dbo.TblEmpTargetRecalcRequest SET BranchID = @GleemBranchID WHERE BranchID IS NULL;

-- Ledger: CashMove → Attendance → Payroll ref → Target ref → GLEEM
UPDATE le
SET le.BranchID = cm.BranchID
FROM dbo.TblEmpLedgerEntry le
INNER JOIN dbo.TblCashMove cm ON cm.ID = le.CashMoveID
WHERE le.BranchID IS NULL AND le.CashMoveID IS NOT NULL AND cm.BranchID IS NOT NULL;

UPDATE le
SET le.BranchID = a.BranchID
FROM dbo.TblEmpLedgerEntry le
INNER JOIN dbo.TblEmpAttendance a ON a.ID = le.AttendanceID
WHERE le.BranchID IS NULL AND le.AttendanceID IS NOT NULL;

UPDATE le
SET le.BranchID = p.BranchID
FROM dbo.TblEmpLedgerEntry le
INNER JOIN dbo.TblEmpDailyPayroll p ON p.ID = le.RefID
WHERE le.BranchID IS NULL
  AND le.RefType = N'TblEmpDailyPayroll'
  AND le.RefID IS NOT NULL
  AND p.BranchID IS NOT NULL;

UPDATE le
SET le.BranchID = t.BranchID
FROM dbo.TblEmpLedgerEntry le
INNER JOIN dbo.TblEmpDailyTarget t ON t.ID = le.RefID
WHERE le.BranchID IS NULL
  AND le.RefType IN (N'TblEmpDailyTarget', N'EmpDailyTarget')
  AND le.RefID IS NOT NULL
  AND t.BranchID IS NOT NULL;

UPDATE dbo.TblEmpLedgerEntry
SET BranchID = @GleemBranchID
WHERE BranchID IS NULL;

-- Fail closed if any null remain
IF EXISTS (SELECT 1 FROM dbo.TblEmpDailyPayroll WHERE BranchID IS NULL)
    OR EXISTS (SELECT 1 FROM dbo.TblEmpLedgerEntry WHERE BranchID IS NULL)
    OR EXISTS (SELECT 1 FROM dbo.TblEmpDailyTarget WHERE BranchID IS NULL)
    OR EXISTS (SELECT 1 FROM dbo.TblEmpTargetRecalcRequest WHERE BranchID IS NULL)
    OR EXISTS (SELECT 1 FROM dbo.TblEmpTargetPlan WHERE BranchID IS NULL)
BEGIN
    RAISERROR(N'Phase 1L abort: null BranchID remains after backfill', 16, 1);
END;

-- CashMove/ledger mismatch must be zero
IF EXISTS (
    SELECT 1
    FROM dbo.TblEmpLedgerEntry le
    INNER JOIN dbo.TblCashMove cm ON cm.ID = le.CashMoveID
    WHERE le.CashMoveID IS NOT NULL AND le.BranchID <> cm.BranchID
)
BEGIN
    RAISERROR(N'Phase 1L abort: ledger/CashMove BranchID mismatch', 16, 1);
END;

PRINT N'Backfill BranchID complete';
GO

------------------------------------------------------------
-- 4) FK + NOT NULL
------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblEmpDailyPayroll_BranchID')
BEGIN
    ALTER TABLE dbo.TblEmpDailyPayroll
        ADD CONSTRAINT FK_TblEmpDailyPayroll_BranchID
        FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch (BranchID);
END
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblEmpLedgerEntry_BranchID')
BEGIN
    ALTER TABLE dbo.TblEmpLedgerEntry
        ADD CONSTRAINT FK_TblEmpLedgerEntry_BranchID
        FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch (BranchID);
END
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblEmpDailyTarget_BranchID')
BEGIN
    ALTER TABLE dbo.TblEmpDailyTarget
        ADD CONSTRAINT FK_TblEmpDailyTarget_BranchID
        FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch (BranchID);
END
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblEmpTargetRecalcRequest_BranchID')
BEGIN
    ALTER TABLE dbo.TblEmpTargetRecalcRequest
        ADD CONSTRAINT FK_TblEmpTargetRecalcRequest_BranchID
        FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch (BranchID);
END
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblEmpTargetPlan_BranchID')
BEGIN
    ALTER TABLE dbo.TblEmpTargetPlan
        ADD CONSTRAINT FK_TblEmpTargetPlan_BranchID
        FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch (BranchID);
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.TblEmpDailyPayroll') AND name = N'BranchID' AND is_nullable = 1)
    ALTER TABLE dbo.TblEmpDailyPayroll ALTER COLUMN BranchID INT NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.TblEmpLedgerEntry') AND name = N'BranchID' AND is_nullable = 1)
    ALTER TABLE dbo.TblEmpLedgerEntry ALTER COLUMN BranchID INT NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.TblEmpDailyTarget') AND name = N'BranchID' AND is_nullable = 1)
    ALTER TABLE dbo.TblEmpDailyTarget ALTER COLUMN BranchID INT NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.TblEmpTargetRecalcRequest') AND name = N'BranchID' AND is_nullable = 1)
    ALTER TABLE dbo.TblEmpTargetRecalcRequest ALTER COLUMN BranchID INT NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.TblEmpTargetPlan') AND name = N'BranchID' AND is_nullable = 1)
    ALTER TABLE dbo.TblEmpTargetPlan ALTER COLUMN BranchID INT NOT NULL;
GO

------------------------------------------------------------
-- 5) Replace uniqueness Emp+WorkDate → Emp+Branch+WorkDate
------------------------------------------------------------
IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.TblEmpDailyPayroll') AND name = N'UX_TblEmpDailyPayroll_EmpID_WorkDate')
    DROP INDEX UX_TblEmpDailyPayroll_EmpID_WorkDate ON dbo.TblEmpDailyPayroll;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.TblEmpDailyPayroll') AND name = N'UX_TblEmpDailyPayroll_Emp_Branch_WorkDate')
    CREATE UNIQUE NONCLUSTERED INDEX UX_TblEmpDailyPayroll_Emp_Branch_WorkDate
        ON dbo.TblEmpDailyPayroll (EmpID, BranchID, WorkDate);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.TblEmpDailyPayroll') AND name = N'IX_TblEmpDailyPayroll_Branch_WorkDate')
    CREATE NONCLUSTERED INDEX IX_TblEmpDailyPayroll_Branch_WorkDate
        ON dbo.TblEmpDailyPayroll (BranchID, WorkDate)
        INCLUDE (EmpID, DailyWage, Status, ActualHours);
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.TblEmpDailyTarget') AND name = N'UQ_TblEmpDailyTarget_Emp_WorkDate')
BEGIN
    -- may be constraint or index
    IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE parent_object_id = OBJECT_ID(N'dbo.TblEmpDailyTarget') AND name = N'UQ_TblEmpDailyTarget_Emp_WorkDate')
        ALTER TABLE dbo.TblEmpDailyTarget DROP CONSTRAINT UQ_TblEmpDailyTarget_Emp_WorkDate;
    ELSE
        DROP INDEX UQ_TblEmpDailyTarget_Emp_WorkDate ON dbo.TblEmpDailyTarget;
END
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.TblEmpDailyTarget') AND name = N'UQ_TblEmpDailyTarget_Emp_Branch_WorkDate')
    CREATE UNIQUE NONCLUSTERED INDEX UQ_TblEmpDailyTarget_Emp_Branch_WorkDate
        ON dbo.TblEmpDailyTarget (EmpID, BranchID, WorkDate);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.TblEmpDailyTarget') AND name = N'IX_TblEmpDailyTarget_Branch_WorkDate')
    CREATE NONCLUSTERED INDEX IX_TblEmpDailyTarget_Branch_WorkDate
        ON dbo.TblEmpDailyTarget (BranchID, WorkDate)
        INCLUDE (EmpID, TargetAmount, NetSalesAfterDiscount, Status);
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.TblEmpTargetRecalcRequest') AND name = N'UX_TblEmpTargetRecalcRequest_EmpID_WorkDate')
BEGIN
    IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE parent_object_id = OBJECT_ID(N'dbo.TblEmpTargetRecalcRequest') AND name = N'UX_TblEmpTargetRecalcRequest_EmpID_WorkDate')
        ALTER TABLE dbo.TblEmpTargetRecalcRequest DROP CONSTRAINT UX_TblEmpTargetRecalcRequest_EmpID_WorkDate;
    ELSE
        DROP INDEX UX_TblEmpTargetRecalcRequest_EmpID_WorkDate ON dbo.TblEmpTargetRecalcRequest;
END
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.TblEmpTargetRecalcRequest') AND name = N'UX_TblEmpTargetRecalcRequest_Emp_Branch_WorkDate')
    CREATE UNIQUE NONCLUSTERED INDEX UX_TblEmpTargetRecalcRequest_Emp_Branch_WorkDate
        ON dbo.TblEmpTargetRecalcRequest (EmpID, BranchID, WorkDate);
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.TblEmpTargetPlan') AND name = N'UX_TblEmpTargetPlan_EmpID_EffectiveFrom')
BEGIN
    IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE parent_object_id = OBJECT_ID(N'dbo.TblEmpTargetPlan') AND name = N'UX_TblEmpTargetPlan_EmpID_EffectiveFrom')
        ALTER TABLE dbo.TblEmpTargetPlan DROP CONSTRAINT UX_TblEmpTargetPlan_EmpID_EffectiveFrom;
    ELSE
        DROP INDEX UX_TblEmpTargetPlan_EmpID_EffectiveFrom ON dbo.TblEmpTargetPlan;
END
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.TblEmpTargetPlan') AND name = N'UX_TblEmpTargetPlan_Emp_Branch_EffectiveFrom')
    CREATE UNIQUE NONCLUSTERED INDEX UX_TblEmpTargetPlan_Emp_Branch_EffectiveFrom
        ON dbo.TblEmpTargetPlan (EmpID, BranchID, EffectiveFrom);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.TblEmpLedgerEntry') AND name = N'IX_TblEmpLedgerEntry_Branch_Emp')
    CREATE NONCLUSTERED INDEX IX_TblEmpLedgerEntry_Branch_Emp
        ON dbo.TblEmpLedgerEntry (BranchID, EmpID, EntryDate DESC)
        INCLUDE (EntryDirection, EntryReason, Amount, IsVoided, PayrollMonth);
GO

------------------------------------------------------------
-- 6) Views: branch-day attendance for payroll; ledger balances
------------------------------------------------------------
IF OBJECT_ID(N'dbo.vw_EmpAttendancePayrollBranchDay', N'V') IS NOT NULL
    DROP VIEW dbo.vw_EmpAttendancePayrollBranchDay;
GO
CREATE VIEW dbo.vw_EmpAttendancePayrollBranchDay
AS
SELECT
    a.BranchID,
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
                THEN CAST(DATEDIFF(MINUTE, CAST(a.CheckInTime AS DATETIME), DATEADD(DAY, 1, CAST(a.CheckOutTime AS DATETIME))) AS DECIMAL(18, 4))
            ELSE CAST(0 AS DECIMAL(18, 4))
        END
        - CAST(ISNULL(a.BreakMinutesTotal, 0) AS DECIMAL(18, 4))
    ) AS NetMinutesRaw,
    SUM(ISNULL(a.BreakMinutesTotal, 0)) AS BreakMinutesTotal,
    CAST(MAX(CASE WHEN a.CheckInTime IS NOT NULL AND a.CheckOutTime IS NULL THEN 1 ELSE 0 END) AS BIT) AS HasOpenSession,
    CAST(MAX(CASE WHEN a.CheckInTime IS NOT NULL THEN 1 ELSE 0 END) AS BIT) AS HasAnyCheckIn
FROM dbo.TblEmpAttendance a
GROUP BY a.BranchID, a.EmpID, a.WorkDate;
GO

IF OBJECT_ID(N'dbo.vw_EmpLedgerBranchBalance', N'V') IS NOT NULL
    DROP VIEW dbo.vw_EmpLedgerBranchBalance;
GO
CREATE VIEW dbo.vw_EmpLedgerBranchBalance
AS
SELECT
    EmpID,
    BranchID,
    ISNULL(SUM(CASE WHEN EntryDirection = N'credit' AND IsVoided = 0 THEN Amount ELSE 0 END), 0) AS TotalCredits,
    ISNULL(SUM(CASE WHEN EntryDirection = N'debit' AND IsVoided = 0 THEN Amount ELSE 0 END), 0) AS TotalDebits,
    ISNULL(SUM(CASE
        WHEN IsVoided = 0 AND EntryDirection = N'credit' THEN Amount
        WHEN IsVoided = 0 AND EntryDirection = N'debit' THEN -Amount
        ELSE 0 END), 0) AS Balance
FROM dbo.TblEmpLedgerEntry
GROUP BY EmpID, BranchID;
GO

IF OBJECT_ID(N'dbo.vw_EmpLedgerGlobalBalance', N'V') IS NOT NULL
    DROP VIEW dbo.vw_EmpLedgerGlobalBalance;
GO
CREATE VIEW dbo.vw_EmpLedgerGlobalBalance
AS
SELECT
    EmpID,
    SUM(TotalCredits) AS TotalCredits,
    SUM(TotalDebits) AS TotalDebits,
    SUM(Balance) AS Balance,
    COUNT(*) AS BranchAccountCount
FROM dbo.vw_EmpLedgerBranchBalance
GROUP BY EmpID;
GO

------------------------------------------------------------
-- 7) Sanity: no PH1GTEST financial rows
------------------------------------------------------------
IF EXISTS (
    SELECT 1 FROM dbo.TblEmpDailyPayroll p
    INNER JOIN dbo.TblBranch b ON b.BranchID = p.BranchID WHERE b.BranchCode = N'PH1GTEST'
) OR EXISTS (
    SELECT 1 FROM dbo.TblEmpLedgerEntry le
    INNER JOIN dbo.TblBranch b ON b.BranchID = le.BranchID WHERE b.BranchCode = N'PH1GTEST'
) OR EXISTS (
    SELECT 1 FROM dbo.TblEmpDailyTarget t
    INNER JOIN dbo.TblBranch b ON b.BranchID = t.BranchID WHERE b.BranchCode = N'PH1GTEST'
)
BEGIN
    RAISERROR(N'Phase 1L abort: PH1GTEST must not own employee-financial rows', 16, 1);
END
GO

PRINT N'Phase 1L migration completed';
GO

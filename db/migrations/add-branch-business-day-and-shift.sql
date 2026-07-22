-- ============================================================
-- Phase 1C: Branch-scoped business day and shift
-- Idempotent. Preserves existing IDs, dates, statuses, times.
-- Does NOT add BranchID to invoices/cash/bookings/queue/payroll.
-- ============================================================
SET NOCOUNT ON;
GO

------------------------------------------------------------
-- 1) Add TblNewDay.BranchID
------------------------------------------------------------
IF COL_LENGTH(N'dbo.TblNewDay', N'BranchID') IS NULL
BEGIN
    ALTER TABLE dbo.TblNewDay ADD BranchID INT NULL;
    PRINT 'Added TblNewDay.BranchID';
END
ELSE
    PRINT 'TblNewDay.BranchID already exists';
GO

------------------------------------------------------------
-- 2) Backfill TblNewDay.BranchID → GLEEM
------------------------------------------------------------
DECLARE @GleemBranchID INT;
SELECT @GleemBranchID = BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM';
IF @GleemBranchID IS NULL
BEGIN
    RAISERROR(N'Phase 1C requires founding branch GLEEM', 16, 1);
END;

UPDATE dbo.TblNewDay
SET BranchID = @GleemBranchID
WHERE BranchID IS NULL;

PRINT CONCAT('Backfilled TblNewDay.BranchID rows; GLEEM=', @GleemBranchID);
GO

------------------------------------------------------------
-- 3) Drop date FK from shifts
------------------------------------------------------------
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblShiftMove_TblNewDay')
BEGIN
    ALTER TABLE dbo.TblShiftMove DROP CONSTRAINT FK_TblShiftMove_TblNewDay;
    PRINT 'Dropped FK_TblShiftMove_TblNewDay';
END
GO

------------------------------------------------------------
-- 4) Replace PK(NewDay) with PK(ID)
-- Change Tracking requires a PK; disable CT briefly, swap PK, re-enable.
------------------------------------------------------------
IF EXISTS (
    SELECT 1
    FROM sys.key_constraints kc
    JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
    JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE kc.parent_object_id = OBJECT_ID(N'dbo.TblNewDay')
      AND kc.type = N'PK'
      AND c.name = N'NewDay'
)
BEGIN
    IF EXISTS (
        SELECT 1 FROM sys.change_tracking_tables
        WHERE object_id = OBJECT_ID(N'dbo.TblNewDay')
    )
    BEGIN
        ALTER TABLE dbo.TblNewDay DISABLE CHANGE_TRACKING;
        PRINT 'Disabled CHANGE_TRACKING on TblNewDay for PK swap';
    END;

    ALTER TABLE dbo.TblNewDay DROP CONSTRAINT PK_TblNewDay;
    PRINT 'Dropped PK_TblNewDay (NewDay)';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.key_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.TblNewDay') AND type = N'PK'
)
BEGIN
    ALTER TABLE dbo.TblNewDay
        ADD CONSTRAINT PK_TblNewDay PRIMARY KEY CLUSTERED (ID);
    PRINT 'Created PK_TblNewDay (ID)';
END
ELSE
    PRINT 'TblNewDay primary key already present';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.change_tracking_tables
    WHERE object_id = OBJECT_ID(N'dbo.TblNewDay')
)
BEGIN
    ALTER TABLE dbo.TblNewDay ENABLE CHANGE_TRACKING WITH (TRACK_COLUMNS_UPDATED = ON);
    PRINT 'Re-enabled CHANGE_TRACKING on TblNewDay';
END
GO

------------------------------------------------------------
-- 5) BranchID NOT NULL + FK + unique indexes
------------------------------------------------------------
IF EXISTS (
    SELECT 1 FROM dbo.TblNewDay WHERE BranchID IS NULL
)
BEGIN
    RAISERROR(N'TblNewDay.BranchID still null after backfill', 16, 1);
END
GO

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.TblNewDay') AND name = N'BranchID' AND is_nullable = 1
)
BEGIN
    ALTER TABLE dbo.TblNewDay ALTER COLUMN BranchID INT NOT NULL;
    PRINT 'TblNewDay.BranchID set NOT NULL';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblNewDay_BranchID')
BEGIN
    ALTER TABLE dbo.TblNewDay
        ADD CONSTRAINT FK_TblNewDay_BranchID
        FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch (BranchID);
    PRINT 'Created FK_TblNewDay_BranchID';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UQ_TblNewDay_Branch_NewDay' AND object_id = OBJECT_ID(N'dbo.TblNewDay')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UQ_TblNewDay_Branch_NewDay
        ON dbo.TblNewDay (BranchID, NewDay);
    PRINT 'Created UQ_TblNewDay_Branch_NewDay';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UX_TblNewDay_OneOpenPerBranch' AND object_id = OBJECT_ID(N'dbo.TblNewDay')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_TblNewDay_OneOpenPerBranch
        ON dbo.TblNewDay (BranchID)
        WHERE Status = 1;
    PRINT 'Created UX_TblNewDay_OneOpenPerBranch';
END
GO

------------------------------------------------------------
-- 6) Add shift ownership columns
------------------------------------------------------------
IF COL_LENGTH(N'dbo.TblShiftMove', N'BranchID') IS NULL
BEGIN
    ALTER TABLE dbo.TblShiftMove ADD BranchID INT NULL;
    PRINT 'Added TblShiftMove.BranchID';
END
GO

IF COL_LENGTH(N'dbo.TblShiftMove', N'BusinessDayID') IS NULL
BEGIN
    ALTER TABLE dbo.TblShiftMove ADD BusinessDayID INT NULL;
    PRINT 'Added TblShiftMove.BusinessDayID';
END
GO

------------------------------------------------------------
-- 7) Backfill shifts
------------------------------------------------------------
DECLARE @GleemBranchID INT;
SELECT @GleemBranchID = BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM';
IF @GleemBranchID IS NULL
BEGIN
    RAISERROR(N'Phase 1C requires founding branch GLEEM', 16, 1);
END;

UPDATE sm
SET
    sm.BranchID = COALESCE(sm.BranchID, @GleemBranchID),
    sm.BusinessDayID = COALESCE(
        sm.BusinessDayID,
        (
            SELECT TOP 1 d.ID
            FROM dbo.TblNewDay d
            WHERE d.NewDay = sm.NewDay
              AND d.BranchID = @GleemBranchID
            ORDER BY d.ID
        )
    )
FROM dbo.TblShiftMove sm
WHERE sm.BranchID IS NULL OR sm.BusinessDayID IS NULL;

IF EXISTS (
    SELECT 1 FROM dbo.TblShiftMove
    WHERE BranchID IS NULL OR BusinessDayID IS NULL
)
BEGIN
    RAISERROR(N'Shift backfill left null BranchID or BusinessDayID', 16, 1);
END;

IF EXISTS (
    SELECT 1
    FROM dbo.TblShiftMove sm
    INNER JOIN dbo.TblNewDay d ON d.ID = sm.BusinessDayID
    WHERE sm.BranchID <> d.BranchID OR sm.NewDay <> d.NewDay
)
BEGIN
    RAISERROR(N'Shift/day branch or date mismatch after backfill', 16, 1);
END;

PRINT 'Backfilled TblShiftMove BranchID/BusinessDayID';
GO

------------------------------------------------------------
-- 8) Shift columns NOT NULL + FKs + indexes
------------------------------------------------------------
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.TblShiftMove') AND name = N'BranchID' AND is_nullable = 1
)
BEGIN
    ALTER TABLE dbo.TblShiftMove ALTER COLUMN BranchID INT NOT NULL;
    PRINT 'TblShiftMove.BranchID set NOT NULL';
END
GO

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.TblShiftMove') AND name = N'BusinessDayID' AND is_nullable = 1
)
BEGIN
    ALTER TABLE dbo.TblShiftMove ALTER COLUMN BusinessDayID INT NOT NULL;
    PRINT 'TblShiftMove.BusinessDayID set NOT NULL';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblShiftMove_BranchID')
BEGIN
    ALTER TABLE dbo.TblShiftMove
        ADD CONSTRAINT FK_TblShiftMove_BranchID
        FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch (BranchID);
    PRINT 'Created FK_TblShiftMove_BranchID';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblShiftMove_BusinessDayID')
BEGIN
    ALTER TABLE dbo.TblShiftMove
        ADD CONSTRAINT FK_TblShiftMove_BusinessDayID
        FOREIGN KEY (BusinessDayID) REFERENCES dbo.TblNewDay (ID);
    PRINT 'Created FK_TblShiftMove_BusinessDayID';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblShiftMove_Branch_BusinessDay' AND object_id = OBJECT_ID(N'dbo.TblShiftMove')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_TblShiftMove_Branch_BusinessDay
        ON dbo.TblShiftMove (BranchID, BusinessDayID, Status)
        INCLUDE (UserID, ShiftID, NewDay);
    PRINT 'Created IX_TblShiftMove_Branch_BusinessDay';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UX_TblShiftMove_OneOpenPerUser' AND object_id = OBJECT_ID(N'dbo.TblShiftMove')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_TblShiftMove_OneOpenPerUser
        ON dbo.TblShiftMove (UserID)
        WHERE Status = 1 AND UserID IS NOT NULL;
    PRINT 'Created UX_TblShiftMove_OneOpenPerUser';
END
GO

------------------------------------------------------------
-- 9) Treasury recon FK (NewDay INT already stores day ID)
------------------------------------------------------------
IF OBJECT_ID(N'dbo.TblTreasuryCloseRecon', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TreasuryCloseRecon_BusinessDay')
BEGIN
    IF EXISTS (
        SELECT 1
        FROM dbo.TblTreasuryCloseRecon r
        WHERE NOT EXISTS (SELECT 1 FROM dbo.TblNewDay d WHERE d.ID = r.NewDay)
    )
    BEGIN
        RAISERROR(N'TblTreasuryCloseRecon.NewDay contains values that are not TblNewDay.ID', 16, 1);
    END;

    ALTER TABLE dbo.TblTreasuryCloseRecon
        ADD CONSTRAINT FK_TreasuryCloseRecon_BusinessDay
        FOREIGN KEY (NewDay) REFERENCES dbo.TblNewDay (ID);
    PRINT 'Created FK_TreasuryCloseRecon_BusinessDay (NewDay INT → TblNewDay.ID)';
END
GO

PRINT 'Phase 1C business-day/shift migration complete';
GO

-- ============================================================
-- Phase 1D: Financial transaction branch ownership
-- Adds BranchID (+ BusinessDayID where mappable) to:
--   TblinvServHead, TblCashMove, TblTreasuryCloseRecon
-- Updates InsCashMoveSales to inherit invoice BranchID/BusinessDayID
-- Does NOT change amounts, invIDs, dates, or child BranchID columns.
-- Idempotent.
-- ============================================================
SET NOCOUNT ON;
GO

DECLARE @GleemBranchID INT;
SELECT @GleemBranchID = BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM';
IF @GleemBranchID IS NULL
BEGIN
    RAISERROR(N'Phase 1D requires founding branch GLEEM', 16, 1);
END;
GO

------------------------------------------------------------
-- 1) Columns on TblinvServHead
------------------------------------------------------------
IF COL_LENGTH(N'dbo.TblinvServHead', N'BranchID') IS NULL
BEGIN
    ALTER TABLE dbo.TblinvServHead ADD BranchID INT NULL;
    PRINT 'Added TblinvServHead.BranchID';
END
GO

IF COL_LENGTH(N'dbo.TblinvServHead', N'BusinessDayID') IS NULL
BEGIN
    ALTER TABLE dbo.TblinvServHead ADD BusinessDayID INT NULL;
    PRINT 'Added TblinvServHead.BusinessDayID';
END
GO

DECLARE @GleemBranchID INT = (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM');

;WITH day_map AS (
    SELECT BranchID, NewDay, MIN(ID) AS BusinessDayID
    FROM dbo.TblNewDay
    GROUP BY BranchID, NewDay
)
UPDATE h
SET
    h.BranchID = COALESCE(h.BranchID, @GleemBranchID),
    h.BusinessDayID = COALESCE(h.BusinessDayID, sm.BusinessDayID, dm.BusinessDayID)
FROM dbo.TblinvServHead h
LEFT JOIN dbo.TblShiftMove sm ON sm.ID = h.ShiftMoveID
LEFT JOIN day_map dm
  ON dm.BranchID = @GleemBranchID
 AND dm.NewDay = CAST(h.invDate AS date)
WHERE h.BranchID IS NULL OR h.BusinessDayID IS NULL;

IF EXISTS (SELECT 1 FROM dbo.TblinvServHead WHERE BranchID IS NULL)
BEGIN
    RAISERROR(N'Invoice BranchID still null after backfill', 16, 1);
END;

PRINT 'Backfilled TblinvServHead ownership';
GO

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.TblinvServHead') AND name = N'BranchID' AND is_nullable = 1
)
BEGIN
    ALTER TABLE dbo.TblinvServHead ALTER COLUMN BranchID INT NOT NULL;
    PRINT 'TblinvServHead.BranchID set NOT NULL';
END
GO

-- BusinessDayID remains nullable only for documented unresolved legacy rows (none expected for invoices)
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.TblinvServHead') AND name = N'BusinessDayID' AND is_nullable = 1
)
   AND NOT EXISTS (SELECT 1 FROM dbo.TblinvServHead WHERE BusinessDayID IS NULL)
BEGIN
    ALTER TABLE dbo.TblinvServHead ALTER COLUMN BusinessDayID INT NOT NULL;
    PRINT 'TblinvServHead.BusinessDayID set NOT NULL';
END
ELSE
    PRINT 'TblinvServHead.BusinessDayID left nullable if unresolved legacy rows exist';
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblinvServHead_BranchID')
BEGIN
    ALTER TABLE dbo.TblinvServHead
        ADD CONSTRAINT FK_TblinvServHead_BranchID
        FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch (BranchID);
    PRINT 'Created FK_TblinvServHead_BranchID';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblinvServHead_BusinessDayID')
BEGIN
    ALTER TABLE dbo.TblinvServHead
        ADD CONSTRAINT FK_TblinvServHead_BusinessDayID
        FOREIGN KEY (BusinessDayID) REFERENCES dbo.TblNewDay (ID);
    PRINT 'Created FK_TblinvServHead_BusinessDayID';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblinvServHead_Branch_invDate' AND object_id = OBJECT_ID(N'dbo.TblinvServHead')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_TblinvServHead_Branch_invDate
        ON dbo.TblinvServHead (BranchID, invDate)
        INCLUDE (invID, invType, GrandTotal, ShiftMoveID, isActive);
    PRINT 'Created IX_TblinvServHead_Branch_invDate';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblinvServHead_Branch_BusinessDay' AND object_id = OBJECT_ID(N'dbo.TblinvServHead')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_TblinvServHead_Branch_BusinessDay
        ON dbo.TblinvServHead (BranchID, BusinessDayID);
    PRINT 'Created IX_TblinvServHead_Branch_BusinessDay';
END
GO

------------------------------------------------------------
-- 2) Columns on TblCashMove
------------------------------------------------------------
IF COL_LENGTH(N'dbo.TblCashMove', N'BranchID') IS NULL
BEGIN
    ALTER TABLE dbo.TblCashMove ADD BranchID INT NULL;
    PRINT 'Added TblCashMove.BranchID';
END
GO

IF COL_LENGTH(N'dbo.TblCashMove', N'BusinessDayID') IS NULL
BEGIN
    ALTER TABLE dbo.TblCashMove ADD BusinessDayID INT NULL;
    PRINT 'Added TblCashMove.BusinessDayID';
END
GO

DECLARE @GleemBranchID INT = (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM');
DECLARE @UnresolvedCashDay INT;

;WITH day_map AS (
    SELECT BranchID, NewDay, MIN(ID) AS BusinessDayID
    FROM dbo.TblNewDay
    GROUP BY BranchID, NewDay
)
UPDATE cm
SET
    cm.BranchID = COALESCE(cm.BranchID, @GleemBranchID),
    cm.BusinessDayID = COALESCE(cm.BusinessDayID, sm.BusinessDayID, dm.BusinessDayID)
FROM dbo.TblCashMove cm
LEFT JOIN dbo.TblShiftMove sm ON sm.ID = cm.ShiftMoveID
LEFT JOIN day_map dm
  ON dm.BranchID = @GleemBranchID
 AND dm.NewDay = CAST(cm.invDate AS date)
WHERE cm.BranchID IS NULL OR cm.BusinessDayID IS NULL;

IF EXISTS (SELECT 1 FROM dbo.TblCashMove WHERE BranchID IS NULL)
BEGIN
    RAISERROR(N'CashMove BranchID still null after backfill', 16, 1);
END;

SELECT @UnresolvedCashDay = COUNT(*) FROM dbo.TblCashMove WHERE BusinessDayID IS NULL;
PRINT CONCAT(N'Backfilled TblCashMove; unresolved BusinessDayID=', @UnresolvedCashDay);
GO

-- Align sale cash BusinessDayID to parent invoice when invID+invType match (deterministic).
-- Covers legacy cash rows with null ShiftMoveID / drifted invDate vs invoice.
UPDATE cm
SET cm.BusinessDayID = h.BusinessDayID
FROM dbo.TblCashMove cm
INNER JOIN dbo.TblinvServHead h
  ON h.invID = cm.invID
 AND h.invType = cm.invType
WHERE cm.invType IN (N'مبيعات', N'م.مبيعات', N'مبيعات بالكارت', N'م.مبيعات بالكارت')
  AND h.BusinessDayID IS NOT NULL
  AND (
        cm.BusinessDayID IS NULL
     OR cm.BusinessDayID <> h.BusinessDayID
  );

PRINT 'Aligned sale cash BusinessDayID to invoice where related';
GO

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.TblCashMove') AND name = N'BranchID' AND is_nullable = 1
)
BEGIN
    ALTER TABLE dbo.TblCashMove ALTER COLUMN BranchID INT NOT NULL;
    PRINT 'TblCashMove.BranchID set NOT NULL';
END
GO

-- Keep BusinessDayID nullable for unresolved legacy cash rows; app requires it on new writes.
PRINT 'TblCashMove.BusinessDayID remains nullable for unresolved legacy rows only';
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblCashMove_BranchID')
BEGIN
    ALTER TABLE dbo.TblCashMove
        ADD CONSTRAINT FK_TblCashMove_BranchID
        FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch (BranchID);
    PRINT 'Created FK_TblCashMove_BranchID';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblCashMove_BusinessDayID')
BEGIN
    ALTER TABLE dbo.TblCashMove
        ADD CONSTRAINT FK_TblCashMove_BusinessDayID
        FOREIGN KEY (BusinessDayID) REFERENCES dbo.TblNewDay (ID);
    PRINT 'Created FK_TblCashMove_BusinessDayID';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblCashMove_Branch_invDate' AND object_id = OBJECT_ID(N'dbo.TblCashMove')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_TblCashMove_Branch_invDate
        ON dbo.TblCashMove (BranchID, invDate)
        INCLUDE (invID, invType, inOut, GrandTolal, PaymentMethodID, ShiftMoveID);
    PRINT 'Created IX_TblCashMove_Branch_invDate';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblCashMove_Branch_BusinessDay' AND object_id = OBJECT_ID(N'dbo.TblCashMove')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_TblCashMove_Branch_BusinessDay
        ON dbo.TblCashMove (BranchID, BusinessDayID);
    PRINT 'Created IX_TblCashMove_Branch_BusinessDay';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblCashMove_Branch_PM_invDate' AND object_id = OBJECT_ID(N'dbo.TblCashMove')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_TblCashMove_Branch_PM_invDate
        ON dbo.TblCashMove (BranchID, PaymentMethodID, invDate)
        INCLUDE (inOut, GrandTolal);
    PRINT 'Created IX_TblCashMove_Branch_PM_invDate';
END
GO

------------------------------------------------------------
-- 3) TblTreasuryCloseRecon.BranchID
------------------------------------------------------------
IF COL_LENGTH(N'dbo.TblTreasuryCloseRecon', N'BranchID') IS NULL
BEGIN
    ALTER TABLE dbo.TblTreasuryCloseRecon ADD BranchID INT NULL;
    PRINT 'Added TblTreasuryCloseRecon.BranchID';
END
GO

UPDATE r
SET r.BranchID = COALESCE(r.BranchID, d.BranchID)
FROM dbo.TblTreasuryCloseRecon r
INNER JOIN dbo.TblNewDay d ON d.ID = r.NewDay
WHERE r.BranchID IS NULL;

IF EXISTS (
    SELECT 1 FROM dbo.TblTreasuryCloseRecon WHERE BranchID IS NULL
)
BEGIN
    -- Empty table or orphan day refs — only fail if rows exist without branch
    IF EXISTS (SELECT 1 FROM dbo.TblTreasuryCloseRecon)
    BEGIN
        RAISERROR(N'Reconciliation BranchID still null after backfill', 16, 1);
    END
END
GO

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.TblTreasuryCloseRecon') AND name = N'BranchID' AND is_nullable = 1
)
   AND EXISTS (SELECT 1 FROM dbo.TblTreasuryCloseRecon)
   AND NOT EXISTS (SELECT 1 FROM dbo.TblTreasuryCloseRecon WHERE BranchID IS NULL)
BEGIN
    ALTER TABLE dbo.TblTreasuryCloseRecon ALTER COLUMN BranchID INT NOT NULL;
    PRINT 'TblTreasuryCloseRecon.BranchID set NOT NULL';
END
ELSE IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.TblTreasuryCloseRecon') AND name = N'BranchID' AND is_nullable = 1
)
   AND NOT EXISTS (SELECT 1 FROM dbo.TblTreasuryCloseRecon)
BEGIN
    -- No rows: still enforce NOT NULL for future inserts
    ALTER TABLE dbo.TblTreasuryCloseRecon ALTER COLUMN BranchID INT NOT NULL;
    PRINT 'TblTreasuryCloseRecon.BranchID set NOT NULL (empty table)';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblTreasuryCloseRecon_BranchID')
BEGIN
    ALTER TABLE dbo.TblTreasuryCloseRecon
        ADD CONSTRAINT FK_TblTreasuryCloseRecon_BranchID
        FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch (BranchID);
    PRINT 'Created FK_TblTreasuryCloseRecon_BranchID';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblTreasuryCloseRecon_Branch_NewDay' AND object_id = OBJECT_ID(N'dbo.TblTreasuryCloseRecon')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_TblTreasuryCloseRecon_Branch_NewDay
        ON dbo.TblTreasuryCloseRecon (BranchID, NewDay);
    PRINT 'Created IX_TblTreasuryCloseRecon_Branch_NewDay';
END
GO

------------------------------------------------------------
-- 4) Replace InsCashMoveSales — multi-row + branch inheritance
-- Preserves live invType / ReservTime rules; set-based INSERTED.
------------------------------------------------------------
IF EXISTS (SELECT 1 FROM sys.triggers WHERE name = N'InsCashMoveSales')
BEGIN
    DROP TRIGGER dbo.InsCashMoveSales;
    PRINT 'Dropped InsCashMoveSales';
END
GO

CREATE TRIGGER dbo.InsCashMoveSales
ON dbo.TblinvServHead
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;

    -- Card sales (cash out) when ReservTime is null
    INSERT INTO dbo.TblCashMove (
        invID, invType, invDate, invTime, ClientID, GrandTolal, inOut,
        Notes, ShiftMoveID, PaymentMethodID, BranchID, BusinessDayID
    )
    SELECT
        i.invID, i.invType, i.invDate, i.invTime, i.ClientID, i.GrandTotal, N'out',
        i.invNotes, i.ShiftMoveID, i.PaymentMethodID, i.BranchID, i.BusinessDayID
    FROM inserted i
    WHERE i.invType = N'مبيعات بالكارت'
      AND i.ReservTime IS NULL
      AND i.BranchID IS NOT NULL;

    -- Card sales reverse (cash in)
    INSERT INTO dbo.TblCashMove (
        invID, invType, invDate, invTime, ClientID, GrandTolal, inOut,
        Notes, ShiftMoveID, PaymentMethodID, BranchID, BusinessDayID
    )
    SELECT
        i.invID, i.invType, i.invDate, i.invTime, i.ClientID, i.GrandTotal, N'in',
        i.invNotes, i.ShiftMoveID, i.PaymentMethodID, i.BranchID, i.BusinessDayID
    FROM inserted i
    WHERE i.invType = N'م.مبيعات بالكارت'
      AND i.BranchID IS NOT NULL;

    -- Standard sales (cash in) when ReservTime is null
    INSERT INTO dbo.TblCashMove (
        invID, invType, invDate, invTime, ClientID, GrandTolal, inOut,
        Notes, ShiftMoveID, PaymentMethodID, BranchID, BusinessDayID
    )
    SELECT
        i.invID, i.invType, i.invDate, i.invTime, i.ClientID, i.GrandTotal, N'in',
        i.invNotes, i.ShiftMoveID, i.PaymentMethodID, i.BranchID, i.BusinessDayID
    FROM inserted i
    WHERE i.invType = N'مبيعات'
      AND i.ReservTime IS NULL
      AND i.BranchID IS NOT NULL;

    -- Standard sales reverse (cash out)
    INSERT INTO dbo.TblCashMove (
        invID, invType, invDate, invTime, ClientID, GrandTolal, inOut,
        Notes, ShiftMoveID, PaymentMethodID, BranchID, BusinessDayID
    )
    SELECT
        i.invID, i.invType, i.invDate, i.invTime, i.ClientID, i.GrandTotal, N'out',
        i.invNotes, i.ShiftMoveID, i.PaymentMethodID, i.BranchID, i.BusinessDayID
    FROM inserted i
    WHERE i.invType = N'م.مبيعات'
      AND i.BranchID IS NOT NULL;
END;
GO

PRINT 'Created InsCashMoveSales with BranchID/BusinessDayID inheritance (multi-row)';
GO

PRINT 'Phase 1D financial branch ownership migration complete';
GO

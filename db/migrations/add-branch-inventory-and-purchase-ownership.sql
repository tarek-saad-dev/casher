-- ============================================================
-- Phase 1J: Branch inventory balances, movement ledger,
--           purchase BranchID ownership
-- Authoritative DB: cloud / last132
-- Idempotent. Does NOT activate a second production branch.
-- Does NOT copy GLEEM stock to PH1GTEST.
-- Does NOT dual-write TblPro.Qty after cutover.
-- ============================================================
SET NOCOUNT ON;
GO

IF DB_NAME() <> N'last132'
BEGIN
    RAISERROR(N'Phase 1J migration requires database last132', 16, 1);
END;
GO

DECLARE @GleemBranchID INT =
    (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM');
IF @GleemBranchID IS NULL
BEGIN
    RAISERROR(N'Phase 1J requires founding branch GLEEM', 16, 1);
END;

IF NOT EXISTS (
    SELECT 1 FROM dbo.TblBranch WHERE BranchCode = N'GLEEM' AND IsActive = 1
)
BEGIN
    RAISERROR(N'GLEEM must be active for Phase 1J', 16, 1);
END;

-- PH1GTEST may exist inactive; do not require it
PRINT CONCAT(N'Phase 1J GLEEM BranchID=', @GleemBranchID);
GO

------------------------------------------------------------
-- 0) Fail if unexpected purchase rows need ownership guessing
------------------------------------------------------------
IF EXISTS (SELECT 1 FROM dbo.TblinvPurchaseHead)
BEGIN
    -- Live expectation at design time was 0. If rows appear later without BranchID,
    -- stop — do not auto-stamp unknown ownership.
    IF COL_LENGTH(N'dbo.TblinvPurchaseHead', N'BranchID') IS NULL
    BEGIN
        RAISERROR(
            N'Phase 1J abort: TblinvPurchaseHead has rows but no BranchID yet — re-audit before backfill',
            16,
            1
        );
    END
END
GO

------------------------------------------------------------
-- 1) TblBranchInventory
------------------------------------------------------------
IF OBJECT_ID(N'dbo.TblBranchInventory', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TblBranchInventory (
        BranchInventoryID INT IDENTITY(1, 1) NOT NULL,
        BranchID INT NOT NULL,
        ProID INT NOT NULL,
        QtyOnHand DECIMAL(10, 2) NOT NULL CONSTRAINT DF_TblBranchInventory_QtyOnHand DEFAULT (0),
        ReorderLevel DECIMAL(10, 2) NULL,
        LastMovementAt DATETIME2(0) NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_TblBranchInventory_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_TblBranchInventory_UpdatedAt DEFAULT (SYSUTCDATETIME()),
        RowVer ROWVERSION NOT NULL,
        CONSTRAINT PK_TblBranchInventory PRIMARY KEY CLUSTERED (BranchInventoryID),
        CONSTRAINT UQ_TblBranchInventory_Branch_Pro UNIQUE (BranchID, ProID),
        CONSTRAINT FK_TblBranchInventory_Branch
            FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch (BranchID),
        CONSTRAINT FK_TblBranchInventory_Pro
            FOREIGN KEY (ProID) REFERENCES dbo.TblPro (ProID),
        CONSTRAINT CK_TblBranchInventory_QtyFinite CHECK (QtyOnHand = QtyOnHand) -- reject NaN-like; SQL decimal ok
    );
    PRINT N'Created TblBranchInventory';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblBranchInventory_Branch_Qty'
      AND object_id = OBJECT_ID(N'dbo.TblBranchInventory')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_TblBranchInventory_Branch_Qty
        ON dbo.TblBranchInventory (BranchID, QtyOnHand)
        INCLUDE (ProID, ReorderLevel);
    PRINT N'Created IX_TblBranchInventory_Branch_Qty';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblBranchInventory_Branch_Reorder'
      AND object_id = OBJECT_ID(N'dbo.TblBranchInventory')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_TblBranchInventory_Branch_Reorder
        ON dbo.TblBranchInventory (BranchID, ReorderLevel, QtyOnHand)
        INCLUDE (ProID)
        WHERE ReorderLevel IS NOT NULL;
    PRINT N'Created IX_TblBranchInventory_Branch_Reorder';
END
GO

------------------------------------------------------------
-- 2) TblInventoryMovement (append-only ledger)
------------------------------------------------------------
IF OBJECT_ID(N'dbo.TblInventoryMovement', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TblInventoryMovement (
        MovementID BIGINT IDENTITY(1, 1) NOT NULL,
        BranchID INT NOT NULL,
        ProID INT NOT NULL,
        QuantityDelta DECIMAL(10, 2) NOT NULL,
        QuantityBefore DECIMAL(10, 2) NOT NULL,
        QuantityAfter DECIMAL(10, 2) NOT NULL,
        MovementType NVARCHAR(40) NOT NULL,
        ReferenceType NVARCHAR(40) NOT NULL,
        ReferenceID NVARCHAR(64) NOT NULL,
        ReferenceLineID NVARCHAR(64) NULL,
        BusinessDayID INT NULL,
        ShiftMoveID INT NULL,
        UserID INT NULL,
        Reason NVARCHAR(400) NULL,
        IdempotencyKey NVARCHAR(120) NOT NULL,
        ReversalOfMovementID BIGINT NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_TblInventoryMovement_CreatedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_TblInventoryMovement PRIMARY KEY CLUSTERED (MovementID),
        CONSTRAINT UQ_TblInventoryMovement_Idempotency UNIQUE (IdempotencyKey),
        CONSTRAINT FK_TblInventoryMovement_Branch
            FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch (BranchID),
        CONSTRAINT FK_TblInventoryMovement_Pro
            FOREIGN KEY (ProID) REFERENCES dbo.TblPro (ProID),
        CONSTRAINT FK_TblInventoryMovement_Reversal
            FOREIGN KEY (ReversalOfMovementID) REFERENCES dbo.TblInventoryMovement (MovementID),
        CONSTRAINT CK_TblInventoryMovement_DeltaNonZero CHECK (QuantityDelta <> 0),
        CONSTRAINT CK_TblInventoryMovement_BeforeAfter
            CHECK (QuantityAfter = QuantityBefore + QuantityDelta)
    );
    PRINT N'Created TblInventoryMovement';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblInventoryMovement_Branch_Pro_Created'
      AND object_id = OBJECT_ID(N'dbo.TblInventoryMovement')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_TblInventoryMovement_Branch_Pro_Created
        ON dbo.TblInventoryMovement (BranchID, ProID, CreatedAt DESC)
        INCLUDE (MovementType, QuantityDelta, QuantityAfter, ReferenceType, ReferenceID);
    PRINT N'Created IX_TblInventoryMovement_Branch_Pro_Created';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblInventoryMovement_Ref'
      AND object_id = OBJECT_ID(N'dbo.TblInventoryMovement')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_TblInventoryMovement_Ref
        ON dbo.TblInventoryMovement (ReferenceType, ReferenceID)
        INCLUDE (BranchID, ProID, MovementType, QuantityDelta);
    PRINT N'Created IX_TblInventoryMovement_Ref';
END
GO

------------------------------------------------------------
-- 3) Purchase header BranchID + PostStatus
------------------------------------------------------------
IF COL_LENGTH(N'dbo.TblinvPurchaseHead', N'BranchID') IS NULL
BEGIN
    ALTER TABLE dbo.TblinvPurchaseHead ADD BranchID INT NULL;
    PRINT N'Added TblinvPurchaseHead.BranchID (nullable)';
END
GO

IF COL_LENGTH(N'dbo.TblinvPurchaseHead', N'PostStatus') IS NULL
BEGIN
    ALTER TABLE dbo.TblinvPurchaseHead
        ADD PostStatus NVARCHAR(30) NOT NULL
            CONSTRAINT DF_TblinvPurchaseHead_PostStatus DEFAULT (N'DRAFT');
    PRINT N'Added TblinvPurchaseHead.PostStatus';
END
GO

IF COL_LENGTH(N'dbo.TblinvPurchaseHead', N'ReturnOfPurchaseInvID') IS NULL
BEGIN
    ALTER TABLE dbo.TblinvPurchaseHead ADD ReturnOfPurchaseInvID INT NULL;
    PRINT N'Added TblinvPurchaseHead.ReturnOfPurchaseInvID';
END
GO

-- Empty table → safe NOT NULL for BranchID via defaulting future inserts only.
-- With 0 rows, set NOT NULL immediately after ensuring no nulls.
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.TblinvPurchaseHead')
      AND name = N'BranchID'
      AND is_nullable = 1
)
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.TblinvPurchaseHead WHERE BranchID IS NULL)
    BEGIN
        RAISERROR(N'Cannot set purchase BranchID NOT NULL — null ownership rows present', 16, 1);
    END
    ELSE
    BEGIN
        -- Add FK first while nullable is fine; then NOT NULL
        IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblinvPurchaseHead_BranchID')
        BEGIN
            ALTER TABLE dbo.TblinvPurchaseHead
                ADD CONSTRAINT FK_TblinvPurchaseHead_BranchID
                FOREIGN KEY (BranchID) REFERENCES dbo.TblBranch (BranchID);
            PRINT N'Created FK_TblinvPurchaseHead_BranchID';
        END

        -- For empty table, ALTER to NOT NULL is safe
        IF NOT EXISTS (SELECT 1 FROM dbo.TblinvPurchaseHead)
        BEGIN
            ALTER TABLE dbo.TblinvPurchaseHead ALTER COLUMN BranchID INT NOT NULL;
            PRINT N'TblinvPurchaseHead.BranchID set NOT NULL (empty table)';
        END
        ELSE
        BEGIN
            ALTER TABLE dbo.TblinvPurchaseHead ALTER COLUMN BranchID INT NOT NULL;
            PRINT N'TblinvPurchaseHead.BranchID set NOT NULL';
        END
    END
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblinvPurchaseHead_Branch_Date'
      AND object_id = OBJECT_ID(N'dbo.TblinvPurchaseHead')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_TblinvPurchaseHead_Branch_Date
        ON dbo.TblinvPurchaseHead (BranchID, invDate DESC)
        INCLUDE (invID, invType, PostStatus, GrandTotal);
    PRINT N'Created IX_TblinvPurchaseHead_Branch_Date';
END
GO

------------------------------------------------------------
-- 4) Optional transfer tables (explicit inter-branch only)
------------------------------------------------------------
IF OBJECT_ID(N'dbo.TblInventoryTransfer', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TblInventoryTransfer (
        TransferID INT IDENTITY(1, 1) NOT NULL,
        FromBranchID INT NOT NULL,
        ToBranchID INT NOT NULL,
        Status NVARCHAR(30) NOT NULL CONSTRAINT DF_TblInventoryTransfer_Status DEFAULT (N'DRAFT'),
        RequestedBy INT NULL,
        PostedBy INT NULL,
        ReceivedBy INT NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_TblInventoryTransfer_CreatedAt DEFAULT (SYSUTCDATETIME()),
        PostedAt DATETIME2(0) NULL,
        ReceivedAt DATETIME2(0) NULL,
        Notes NVARCHAR(400) NULL,
        IdempotencyKey NVARCHAR(120) NULL,
        CONSTRAINT PK_TblInventoryTransfer PRIMARY KEY CLUSTERED (TransferID),
        CONSTRAINT FK_TblInventoryTransfer_From
            FOREIGN KEY (FromBranchID) REFERENCES dbo.TblBranch (BranchID),
        CONSTRAINT FK_TblInventoryTransfer_To
            FOREIGN KEY (ToBranchID) REFERENCES dbo.TblBranch (BranchID),
        CONSTRAINT CK_TblInventoryTransfer_DistinctBranches
            CHECK (FromBranchID <> ToBranchID),
        CONSTRAINT UQ_TblInventoryTransfer_Idempotency UNIQUE (IdempotencyKey)
    );
    PRINT N'Created TblInventoryTransfer';
END
GO

IF OBJECT_ID(N'dbo.TblInventoryTransferLine', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TblInventoryTransferLine (
        TransferLineID INT IDENTITY(1, 1) NOT NULL,
        TransferID INT NOT NULL,
        ProID INT NOT NULL,
        Quantity DECIMAL(10, 2) NOT NULL,
        CONSTRAINT PK_TblInventoryTransferLine PRIMARY KEY CLUSTERED (TransferLineID),
        CONSTRAINT FK_TblInventoryTransferLine_Transfer
            FOREIGN KEY (TransferID) REFERENCES dbo.TblInventoryTransfer (TransferID),
        CONSTRAINT FK_TblInventoryTransferLine_Pro
            FOREIGN KEY (ProID) REFERENCES dbo.TblPro (ProID),
        CONSTRAINT CK_TblInventoryTransferLine_QtyPositive CHECK (Quantity > 0)
    );
    PRINT N'Created TblInventoryTransferLine';
END
GO

------------------------------------------------------------
-- 5) GLEEM opening balances for stock-tracked products only
--    Tracked = CatType='pro' OR ProType='pro' (case-insensitive)
--    QtyOnHand = ISNULL(TblPro.Qty, 0) — currently all 0/null on last132
--    No rows for PH1GTEST
------------------------------------------------------------
DECLARE @GleemBranchID INT =
    (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM');

;WITH Tracked AS (
    SELECT
        p.ProID,
        CAST(ISNULL(p.Qty, 0) AS DECIMAL(10, 2)) AS OpeningQty
    FROM dbo.TblPro p
    LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
    WHERE LOWER(ISNULL(c.CatType, N'')) = N'pro'
       OR LOWER(ISNULL(p.ProType, N'')) = N'pro'
)
INSERT INTO dbo.TblBranchInventory (BranchID, ProID, QtyOnHand, ReorderLevel, LastMovementAt)
SELECT @GleemBranchID, t.ProID, t.OpeningQty, NULL, SYSUTCDATETIME()
FROM Tracked t
WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.TblBranchInventory bi
    WHERE bi.BranchID = @GleemBranchID AND bi.ProID = t.ProID
);

PRINT CONCAT(N'GLEEM branch inventory rows ensured for tracked products; inserted=', @@ROWCOUNT);
GO

-- Opening movements (idempotent via IdempotencyKey). Do NOT alter QtyOnHand again.
DECLARE @GleemBranchID INT =
    (SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM');

INSERT INTO dbo.TblInventoryMovement (
    BranchID, ProID, QuantityDelta, QuantityBefore, QuantityAfter,
    MovementType, ReferenceType, ReferenceID, ReferenceLineID,
    BusinessDayID, ShiftMoveID, UserID, Reason, IdempotencyKey
)
SELECT
    bi.BranchID,
    bi.ProID,
    bi.QtyOnHand,
    CAST(0 AS DECIMAL(10, 2)),
    bi.QtyOnHand,
    N'OPENING_BALANCE',
    N'LEGACY_TBLPRO_QTY',
    CONCAT(N'GLEEM:', bi.ProID),
    NULL,
    NULL,
    NULL,
    NULL,
    N'Phase 1J opening from TblPro.Qty snapshot (deprecated column)',
    CONCAT(N'OPENING:GLEEM:', bi.ProID)
FROM dbo.TblBranchInventory bi
WHERE bi.BranchID = @GleemBranchID
  AND bi.QtyOnHand <> 0
  AND NOT EXISTS (
      SELECT 1 FROM dbo.TblInventoryMovement m
      WHERE m.IdempotencyKey = CONCAT(N'OPENING:GLEEM:', bi.ProID)
  );

-- Exact-zero openings: balance row is source of truth; no OPENING_BALANCE
-- movement (QuantityDelta must be non-zero). Documented in Phase 1J docs.
PRINT N'Opening movements inserted for non-zero GLEEM balances only';
GO

------------------------------------------------------------
-- 6) Mark TblPro.Qty as deprecated via extended property (no drop)
------------------------------------------------------------
IF NOT EXISTS (
    SELECT 1
    FROM sys.extended_properties
    WHERE major_id = OBJECT_ID(N'dbo.TblPro')
      AND minor_id = COLUMNPROPERTY(OBJECT_ID(N'dbo.TblPro'), N'Qty', 'ColumnId')
      AND name = N'MS_Description'
)
BEGIN
    EXEC sys.sp_addextendedproperty
        @name = N'MS_Description',
        @value = N'DEPRECATED Phase 1J — operational stock is TblBranchInventory.QtyOnHand. Do not use for POS.',
        @level0type = N'SCHEMA', @level0name = N'dbo',
        @level1type = N'TABLE',  @level1name = N'TblPro',
        @level2type = N'COLUMN', @level2name = N'Qty';
    PRINT N'Annotated TblPro.Qty as deprecated';
END
GO

------------------------------------------------------------
-- 7) Sanity: PH1GTEST must have zero inventory rows copied
------------------------------------------------------------
IF EXISTS (
    SELECT 1
    FROM dbo.TblBranchInventory bi
    INNER JOIN dbo.TblBranch b ON b.BranchID = bi.BranchID
    WHERE b.BranchCode = N'PH1GTEST'
)
BEGIN
    RAISERROR(N'Phase 1J abort: PH1GTEST must not receive GLEEM inventory backfill', 16, 1);
END
GO

PRINT N'Phase 1J migration completed';
GO

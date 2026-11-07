-- ============================================================
-- DRVO-022: Retail product catalog extensions + stock policy
-- Idempotent. Additive only. Never writes TblPro.Qty.
-- Never invents opening stock quantities.
-- ============================================================
SET NOCOUNT ON;

------------------------------------------------------------
-- 1) TblPro retail catalog columns
------------------------------------------------------------
IF COL_LENGTH(N'dbo.TblPro', N'ProductCode') IS NULL
BEGIN
    ALTER TABLE dbo.TblPro ADD ProductCode NVARCHAR(40) NULL;
    PRINT N'Added TblPro.ProductCode';
END;

IF COL_LENGTH(N'dbo.TblPro', N'Brand') IS NULL
BEGIN
    ALTER TABLE dbo.TblPro ADD Brand NVARCHAR(100) NULL;
    PRINT N'Added TblPro.Brand';
END;

IF COL_LENGTH(N'dbo.TblPro', N'Description') IS NULL
BEGIN
    ALTER TABLE dbo.TblPro ADD Description NVARCHAR(500) NULL;
    PRINT N'Added TblPro.Description';
END;

IF COL_LENGTH(N'dbo.TblPro', N'StockUnit') IS NULL
BEGIN
    ALTER TABLE dbo.TblPro ADD StockUnit NVARCHAR(30) NULL;
    PRINT N'Added TblPro.StockUnit';
END;

IF COL_LENGTH(N'dbo.TblPro', N'UnitsPerPack') IS NULL
BEGIN
    ALTER TABLE dbo.TblPro ADD UnitsPerPack DECIMAL(10, 2) NULL;
    PRINT N'Added TblPro.UnitsPerPack';
END;

IF COL_LENGTH(N'dbo.TblPro', N'SuggestedRetailPrice') IS NULL
BEGIN
    ALTER TABLE dbo.TblPro ADD SuggestedRetailPrice DECIMAL(10, 2) NULL;
    PRINT N'Added TblPro.SuggestedRetailPrice';
END;

IF COL_LENGTH(N'dbo.TblPro', N'MinStockThreshold') IS NULL
BEGIN
    ALTER TABLE dbo.TblPro ADD MinStockThreshold DECIMAL(10, 2) NULL;
    PRINT N'Added TblPro.MinStockThreshold';
END;

IF COL_LENGTH(N'dbo.TblPro', N'SupplierRef') IS NULL
BEGIN
    ALTER TABLE dbo.TblPro ADD SupplierRef NVARCHAR(200) NULL;
    PRINT N'Added TblPro.SupplierRef';
END;

IF COL_LENGTH(N'dbo.TblPro', N'CreatedAt') IS NULL
BEGIN
    ALTER TABLE dbo.TblPro ADD CreatedAt DATETIME2(0) NULL
        CONSTRAINT DF_TblPro_CreatedAt DEFAULT (SYSUTCDATETIME());
    PRINT N'Added TblPro.CreatedAt';
END;

IF COL_LENGTH(N'dbo.TblPro', N'UpdatedAt') IS NULL
BEGIN
    ALTER TABLE dbo.TblPro ADD UpdatedAt DATETIME2(0) NULL
        CONSTRAINT DF_TblPro_UpdatedAt DEFAULT (SYSUTCDATETIME());
    PRINT N'Added TblPro.UpdatedAt';
END;
GO

-- Tenant-scoped unique ProductCode (alphanumeric + punctuation preserved as NVARCHAR)
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UQ_TblPro_Tenant_ProductCode'
      AND object_id = OBJECT_ID(N'dbo.TblPro')
)
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UQ_TblPro_Tenant_ProductCode
        ON dbo.TblPro (TenantId, ProductCode)
        WHERE ProductCode IS NOT NULL AND ProductCode <> N'';
    PRINT N'Created UQ_TblPro_Tenant_ProductCode';
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TblPro_Tenant_Barcode'
      AND object_id = OBJECT_ID(N'dbo.TblPro')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_TblPro_Tenant_Barcode
        ON dbo.TblPro (TenantId, Barcode)
        WHERE Barcode IS NOT NULL AND Barcode <> N'';
    PRINT N'Created IX_TblPro_Tenant_Barcode';
END;
GO

------------------------------------------------------------
-- 2) Tenant stock policy (strict non-negative transition)
------------------------------------------------------------
IF OBJECT_ID(N'dbo.TblInventoryStockPolicy', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TblInventoryStockPolicy (
        TenantId UNIQUEIDENTIFIER NOT NULL,
        AllowNegativeStock BIT NOT NULL
            CONSTRAINT DF_TblInventoryStockPolicy_AllowNeg DEFAULT (1),
        OpeningStockRegistered BIT NOT NULL
            CONSTRAINT DF_TblInventoryStockPolicy_Opening DEFAULT (0),
        NegativeBalancesReconciled BIT NOT NULL
            CONSTRAINT DF_TblInventoryStockPolicy_Reconciled DEFAULT (0),
        StrictModeActivatedAt DATETIME2(0) NULL,
        UpdatedAt DATETIME2(0) NOT NULL
            CONSTRAINT DF_TblInventoryStockPolicy_UpdatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedByUserID INT NULL,
        Notes NVARCHAR(400) NULL,
        CONSTRAINT PK_TblInventoryStockPolicy PRIMARY KEY CLUSTERED (TenantId),
        CONSTRAINT FK_TblInventoryStockPolicy_Tenant
            FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId)
    );
    PRINT N'Created TblInventoryStockPolicy';
END;
GO

------------------------------------------------------------
-- 3) Transfer status contract (widen if legacy default-only)
------------------------------------------------------------
IF OBJECT_ID(N'dbo.TblInventoryTransfer', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.TblInventoryTransfer', N'Status') IS NOT NULL
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM sys.check_constraints
        WHERE parent_object_id = OBJECT_ID(N'dbo.TblInventoryTransfer')
          AND name = N'CK_TblInventoryTransfer_Status'
    )
    BEGIN
        ALTER TABLE dbo.TblInventoryTransfer WITH NOCHECK
        ADD CONSTRAINT CK_TblInventoryTransfer_Status
        CHECK (Status IN (N'DRAFT', N'POSTED', N'IN_TRANSIT', N'RECEIVED', N'CANCELLED'));
        PRINT N'Added CK_TblInventoryTransfer_Status';
    END
END;
GO

------------------------------------------------------------
-- 4) Sale line cost snapshot (COGS) — additive nullable
------------------------------------------------------------
IF OBJECT_ID(N'dbo.TblinvServDetail', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.TblinvServDetail', N'UnitCostSnapshot') IS NULL
BEGIN
    ALTER TABLE dbo.TblinvServDetail ADD UnitCostSnapshot DECIMAL(10, 2) NULL;
    PRINT N'Added TblinvServDetail.UnitCostSnapshot';
END;
GO

PRINT N'DRVO-022 retail product catalog schema complete';

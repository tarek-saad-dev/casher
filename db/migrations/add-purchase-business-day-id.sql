------------------------------------------------------------
-- Phase 5 — additive TblinvPurchaseHead.BusinessDayID
-- Nullable; no historical backfill; no destructive rewrite.
------------------------------------------------------------
SET NOCOUNT ON;
GO

IF COL_LENGTH(N'dbo.TblinvPurchaseHead', N'BusinessDayID') IS NULL
BEGIN
    ALTER TABLE dbo.TblinvPurchaseHead ADD BusinessDayID INT NULL;
    PRINT N'Added TblinvPurchaseHead.BusinessDayID (nullable)';
END
GO

IF COL_LENGTH(N'dbo.TblinvPurchaseHead', N'BusinessDayID') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblinvPurchaseHead_BusinessDayID')
BEGIN
    ALTER TABLE dbo.TblinvPurchaseHead
        ADD CONSTRAINT FK_TblinvPurchaseHead_BusinessDayID
        FOREIGN KEY (BusinessDayID) REFERENCES dbo.TblNewDay (ID);
    PRINT N'Created FK_TblinvPurchaseHead_BusinessDayID';
END
GO

IF COL_LENGTH(N'dbo.TblinvPurchaseHead', N'BusinessDayID') IS NOT NULL
   AND NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = N'IX_TblinvPurchaseHead_Branch_BusinessDay'
          AND object_id = OBJECT_ID(N'dbo.TblinvPurchaseHead')
   )
BEGIN
    CREATE NONCLUSTERED INDEX IX_TblinvPurchaseHead_Branch_BusinessDay
        ON dbo.TblinvPurchaseHead (BranchID, BusinessDayID);
    PRINT N'Created IX_TblinvPurchaseHead_Branch_BusinessDay';
END
GO

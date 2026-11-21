/*
 CUT CLUB 2.0 — staging-only reviewed transaction idempotency table for current OTP.

 NOT in migration runner; MUST NOT auto-apply. No production ALTER/DDL
 permission has been exercised. Operator schema/reconciliation approval
 required before any migration. No financial code is live.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() <> N'last132_agent' OR SUSER_SNAME() <> N'drvo_agent'
  THROW 51960, 'CUT CLUB reward command schema: staging only', 1;

IF OBJECT_ID(N'dbo.Tenant',N'U') IS NULL
  THROW 51961, 'Tenant foundation missing', 1;

BEGIN TRY
  BEGIN TRAN;
  IF OBJECT_ID(N'dbo.CutClubRewardCommand',N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.CutClubRewardCommand (
      TenantId UNIQUEIDENTIFIER NOT NULL,
      CustomerId INT NOT NULL,
      BranchId INT NOT NULL,
      IdempotencyKey VARCHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
      ItemId INT NOT NULL,
      InventoryId INT NOT NULL,
      CoinsCharged DECIMAL(18,2) NOT NULL,
      BalanceAfter DECIMAL(18,2) NOT NULL,
      VoucherCode VARCHAR(100) COLLATE Latin1_General_100_BIN2 NOT NULL,
      CreatedAtUtc DATETIME2 NOT NULL CONSTRAINT DF_CutClubRewardCommand_Created DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_CutClubRewardCommand PRIMARY KEY (TenantId, CustomerId, IdempotencyKey),
      CONSTRAINT FK_CutClubRewardCommand_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant(TenantId),
      CONSTRAINT FK_CutClubRewardCommand_Customer FOREIGN KEY (CustomerId) REFERENCES dbo.TblClient(ClientID),
      CONSTRAINT FK_CutClubRewardCommand_Inventory FOREIGN KEY (InventoryId) REFERENCES dbo.TblClientInventory(InventoryID),
      CONSTRAINT UQ_CutClubRewardCommand_Voucher UNIQUE (VoucherCode),
      CONSTRAINT CK_CutClubRewardCommand_Ids CHECK (CustomerId > 0 AND BranchId > 0 AND ItemId > 0 AND InventoryId > 0),
      CONSTRAINT CK_CutClubRewardCommand_Amounts CHECK (CoinsCharged > 0 AND BalanceAfter >= 0)
    );
  END;
  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

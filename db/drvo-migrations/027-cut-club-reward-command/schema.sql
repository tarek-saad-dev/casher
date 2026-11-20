/*
 * DRVO-027 CUT CLUB reward purchase idempotency record.
 * Additive only: one new table. Does not touch balances, ledgers, vouchers or
 * store items. The purchase code stays OFF until CUT_CLUB_REWARD_PURCHASE_ENABLED.
 *
 * Production execution MUST use the DRVO immutable migration manifest,
 * exact SHA PLAN/APPLY approvals and a verified production backup reference.
 * NEVER execute this file manually on production.
 */
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() NOT IN (N'last132_agent', N'last132')
  THROW 51270, 'CUT_CLUB_REWARD_MIGRATION_UNEXPECTED_DATABASE', 1;

IF OBJECT_ID(N'dbo.Tenant',N'U') IS NULL
    OR OBJECT_ID(N'dbo.TblClient',N'U') IS NULL
    OR OBJECT_ID(N'dbo.TblClientInventory',N'U') IS NULL
    OR OBJECT_ID(N'dbo.CutClubMemberAccount',N'U') IS NULL
  THROW 51271, 'CUT_CLUB_REWARD_MIGRATION_PREREQUISITES_MISSING', 1;

BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.CutClubRewardCommand',N'U') IS NULL
BEGIN
  CREATE TABLE dbo.CutClubRewardCommand(
    TenantId UNIQUEIDENTIFIER NOT NULL,
    CustomerId INT NOT NULL,
    SalonId INT NOT NULL,
    IdempotencyKey VARCHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
    ItemId INT NOT NULL,
    InventoryId INT NOT NULL,
    CoinsCharged DECIMAL(18,2) NOT NULL,
    BalanceAfter DECIMAL(18,2) NOT NULL,
    VoucherCode VARCHAR(100) COLLATE Latin1_General_100_BIN2 NOT NULL,
    CreatedAtUtc DATETIME2(3) NOT NULL
      CONSTRAINT DF_CutClubRewardCommand_Created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_CutClubRewardCommand PRIMARY KEY(TenantId,CustomerId,IdempotencyKey),
    CONSTRAINT FK_CutClubRewardCommand_Tenant FOREIGN KEY(TenantId)
      REFERENCES dbo.Tenant(TenantId),
    CONSTRAINT FK_CutClubRewardCommand_Customer FOREIGN KEY(CustomerId)
      REFERENCES dbo.TblClient(ClientID),
    CONSTRAINT FK_CutClubRewardCommand_Inventory FOREIGN KEY(InventoryId)
      REFERENCES dbo.TblClientInventory(InventoryID),
    CONSTRAINT UQ_CutClubRewardCommand_Voucher UNIQUE(VoucherCode),
    CONSTRAINT CK_CutClubRewardCommand_Ids CHECK
      (CustomerId>0 AND SalonId>0 AND ItemId>0 AND InventoryId>0),
    CONSTRAINT CK_CutClubRewardCommand_Amounts CHECK
      (CoinsCharged>0 AND BalanceAfter>=0)
  );
END;

COMMIT TRANSACTION;

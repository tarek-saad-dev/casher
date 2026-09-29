-- DRVO-007: Treasury movement idempotency registry + reversal linkage on TblCashMove.
-- Applied by scripts/drvo007Migration.ts (granular, idempotent steps with preflight).
-- This file documents the target schema; the TypeScript runner is authoritative on deploy.

-- Minimal Platform Core prerequisite (production-safe, idempotent):
--   dbo.Tenant (same shape as DRVO-003) + bootstrap CASHER_BOOT row when table is empty

-- TreasuryMovementRegistry:
--   table, indexes, FK_TreasuryMovementRegistry_Tenant, FK_TreasuryMovementRegistry_CashMove

-- TblCashMove reversal columns:
--   ReversalOfCashMoveId, IsReversed, FK_TblCashMove_ReversalOf

IF OBJECT_ID(N'dbo.Tenant', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Tenant (
    TenantId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Tenant_TenantId DEFAULT NEWSEQUENTIALID(),
    Code NVARCHAR(64) NOT NULL,
    Name NVARCHAR(256) NOT NULL,
    Status NVARCHAR(20) NOT NULL CONSTRAINT DF_Tenant_Status DEFAULT N'active',
    DefaultTimezone NVARCHAR(64) NOT NULL CONSTRAINT DF_Tenant_TZ DEFAULT N'Africa/Cairo',
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Tenant_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_Tenant_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Tenant PRIMARY KEY (TenantId),
    CONSTRAINT UQ_Tenant_Code UNIQUE (Code),
    CONSTRAINT CK_Tenant_Status CHECK (Status IN (N'active', N'suspended'))
  );
END
GO

IF OBJECT_ID(N'dbo.TreasuryMovementRegistry', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TreasuryMovementRegistry (
    Id BIGINT IDENTITY(1,1) NOT NULL,
    TenantId UNIQUEIDENTIFIER NOT NULL,
    IdempotencyKey NVARCHAR(256) NOT NULL,
    Fingerprint NVARCHAR(128) NOT NULL,
    Kind NVARCHAR(32) NOT NULL,
    CashMoveId INT NOT NULL,
    TransferGroupKey NVARCHAR(256) NULL,
    OriginalIdempotencyKey NVARCHAR(256) NULL,
    SourceRef NVARCHAR(256) NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_TreasuryMovementRegistry_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_TreasuryMovementRegistry PRIMARY KEY (Id)
  );
END
GO

IF OBJECT_ID(N'dbo.TreasuryMovementRegistry', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UX_TreasuryMovementRegistry_Tenant_Idempotency'
      AND object_id = OBJECT_ID(N'dbo.TreasuryMovementRegistry')
  )
BEGIN
  CREATE UNIQUE INDEX UX_TreasuryMovementRegistry_Tenant_Idempotency
    ON dbo.TreasuryMovementRegistry (TenantId, IdempotencyKey);
END
GO

IF OBJECT_ID(N'dbo.TreasuryMovementRegistry', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TreasuryMovementRegistry_CashMove'
      AND object_id = OBJECT_ID(N'dbo.TreasuryMovementRegistry')
  )
BEGIN
  CREATE INDEX IX_TreasuryMovementRegistry_CashMove
    ON dbo.TreasuryMovementRegistry (CashMoveId);
END
GO

IF OBJECT_ID(N'dbo.TreasuryMovementRegistry', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TreasuryMovementRegistry_TransferGroup'
      AND object_id = OBJECT_ID(N'dbo.TreasuryMovementRegistry')
  )
BEGIN
  CREATE INDEX IX_TreasuryMovementRegistry_TransferGroup
    ON dbo.TreasuryMovementRegistry (TenantId, TransferGroupKey)
    WHERE TransferGroupKey IS NOT NULL;
END
GO

IF OBJECT_ID(N'dbo.TreasuryMovementRegistry', N'U') IS NOT NULL
  AND OBJECT_ID(N'dbo.Tenant', N'U') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TreasuryMovementRegistry_Tenant')
BEGIN
  ALTER TABLE dbo.TreasuryMovementRegistry
    ADD CONSTRAINT FK_TreasuryMovementRegistry_Tenant
    FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId);
END
GO

IF OBJECT_ID(N'dbo.TreasuryMovementRegistry', N'U') IS NOT NULL
  AND OBJECT_ID(N'dbo.TblCashMove', N'U') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TreasuryMovementRegistry_CashMove')
BEGIN
  ALTER TABLE dbo.TreasuryMovementRegistry
    ADD CONSTRAINT FK_TreasuryMovementRegistry_CashMove
    FOREIGN KEY (CashMoveId) REFERENCES dbo.TblCashMove (ID);
END
GO

IF COL_LENGTH(N'dbo.TblCashMove', N'ReversalOfCashMoveId') IS NULL
BEGIN
  ALTER TABLE dbo.TblCashMove ADD ReversalOfCashMoveId INT NULL;
END
GO

IF COL_LENGTH(N'dbo.TblCashMove', N'IsReversed') IS NULL
BEGIN
  ALTER TABLE dbo.TblCashMove ADD IsReversed BIT NOT NULL CONSTRAINT DF_TblCashMove_IsReversed DEFAULT 0;
END
GO

IF COL_LENGTH(N'dbo.TblCashMove', N'ReversalOfCashMoveId') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblCashMove_ReversalOf')
BEGIN
  ALTER TABLE dbo.TblCashMove
    ADD CONSTRAINT FK_TblCashMove_ReversalOf
    FOREIGN KEY (ReversalOfCashMoveId) REFERENCES dbo.TblCashMove (ID);
END
GO

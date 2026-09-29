-- DRVO-007: Treasury movement idempotency registry + reversal linkage on TblCashMove.
-- Safe to run on staging (last132_agent) and production when merged.

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
    CONSTRAINT PK_TreasuryMovementRegistry PRIMARY KEY (Id),
    CONSTRAINT FK_TreasuryMovementRegistry_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId),
    CONSTRAINT FK_TreasuryMovementRegistry_CashMove FOREIGN KEY (CashMoveId) REFERENCES dbo.TblCashMove (ID)
  );

  CREATE UNIQUE INDEX UX_TreasuryMovementRegistry_Tenant_Idempotency
    ON dbo.TreasuryMovementRegistry (TenantId, IdempotencyKey);

  CREATE INDEX IX_TreasuryMovementRegistry_CashMove
    ON dbo.TreasuryMovementRegistry (CashMoveId);

  CREATE INDEX IX_TreasuryMovementRegistry_TransferGroup
    ON dbo.TreasuryMovementRegistry (TenantId, TransferGroupKey)
    WHERE TransferGroupKey IS NOT NULL;

  PRINT 'Created TreasuryMovementRegistry';
END
ELSE
  PRINT 'TreasuryMovementRegistry already exists';
GO

IF COL_LENGTH(N'dbo.TblCashMove', N'ReversalOfCashMoveId') IS NULL
BEGIN
  ALTER TABLE dbo.TblCashMove ADD ReversalOfCashMoveId INT NULL;
  PRINT 'Added TblCashMove.ReversalOfCashMoveId';
END
GO

IF COL_LENGTH(N'dbo.TblCashMove', N'IsReversed') IS NULL
BEGIN
  ALTER TABLE dbo.TblCashMove ADD IsReversed BIT NOT NULL CONSTRAINT DF_TblCashMove_IsReversed DEFAULT 0;
  PRINT 'Added TblCashMove.IsReversed';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblCashMove_ReversalOf'
)
BEGIN
  ALTER TABLE dbo.TblCashMove
    ADD CONSTRAINT FK_TblCashMove_ReversalOf
    FOREIGN KEY (ReversalOfCashMoveId) REFERENCES dbo.TblCashMove (ID);
  PRINT 'Added FK_TblCashMove_ReversalOf';
END
GO

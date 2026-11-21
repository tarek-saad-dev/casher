-- Cut Salon Financial Intelligence MVP.
-- Apply only after DB backup and verification on staging; does not modify legacy tables.
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.TblFinInsightCommitment', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblFinInsightCommitment (
    ID int IDENTITY(1,1) NOT NULL PRIMARY KEY,
    TenantId uniqueidentifier NOT NULL,
    BranchID int NOT NULL,
    Title nvarchar(160) NOT NULL,
    Kind nvarchar(30) NOT NULL,
    Amount decimal(18,2) NOT NULL,
    DueDate date NOT NULL,
    Frequency varchar(10) NOT NULL CONSTRAINT DF_FinInsightCommitmentFrequency DEFAULT ('once'),
    EndDate date NULL,
    IsActive bit NOT NULL CONSTRAINT DF_FinInsightCommitmentIsActive DEFAULT (1),
    CreatedByUserID int NULL,
    CreatedAt datetime2(3) NOT NULL CONSTRAINT DF_FinInsightCommitmentCreatedAt DEFAULT (sysutcdatetime()),
    CONSTRAINT CK_FinInsightCommitmentAmount CHECK (Amount > 0),
    CONSTRAINT CK_FinInsightCommitmentFreq CHECK (Frequency IN ('once','monthly')),
    CONSTRAINT CK_FinInsightCommitmentKind CHECK (Kind IN ('rent','payroll','installment','debt','supplier','utilities','other')),
    CONSTRAINT CK_FinInsightCommitmentEnd CHECK (EndDate IS NULL OR EndDate >= DueDate)
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.TblFinInsightCommitment') AND name=N'IX_FinInsightCommitmentTenantBranchDue')
  CREATE INDEX IX_FinInsightCommitmentTenantBranchDue
  ON dbo.TblFinInsightCommitment (TenantId, BranchID, IsActive, DueDate)
  INCLUDE (Amount, EndDate, Frequency);

IF OBJECT_ID(N'dbo.TblFinInsightSettlement', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblFinInsightSettlement (
    ID bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
    CommitmentID int NOT NULL,
    DueDate date NOT NULL,
    Amount decimal(18,2) NOT NULL,
    CashMoveID int NULL,
    CreatedByUserID int NULL,
    CreatedAt datetime2(3) NOT NULL CONSTRAINT DF_FinInsightSettlementCreatedAt DEFAULT (sysutcdatetime()),
    CONSTRAINT FK_FinInsightSettlementCommitment FOREIGN KEY (CommitmentID)
      REFERENCES dbo.TblFinInsightCommitment(ID),
    CONSTRAINT CK_FinInsightSettlementAmount CHECK (Amount > 0)
  );
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.TblFinInsightSettlement') AND name=N'IX_FinInsightSettlementDue')
  CREATE INDEX IX_FinInsightSettlementDue ON dbo.TblFinInsightSettlement(CommitmentID, DueDate) INCLUDE (Amount);

IF OBJECT_ID(N'dbo.TblFinInsightLiquidityCheck', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblFinInsightLiquidityCheck (
    ID bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
    TenantId uniqueidentifier NOT NULL,
    BranchID int NOT NULL,
    AsOfDate date NOT NULL,
    AvailableAmount decimal(18,2) NOT NULL,
    CreatedByUserID int NOT NULL,
    CreatedAt datetime2(3) NOT NULL CONSTRAINT DF_FinInsightLiquidityCreatedAt DEFAULT (sysutcdatetime()),
    CONSTRAINT CK_FinInsightLiquidityAvailable CHECK (AvailableAmount >= 0)
  );
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.TblFinInsightLiquidityCheck') AND name=N'IX_FinInsightLiquidityLatest')
  CREATE INDEX IX_FinInsightLiquidityLatest ON dbo.TblFinInsightLiquidityCheck(TenantId, BranchID, AsOfDate DESC, ID DESC) INCLUDE(AvailableAmount);

IF OBJECT_ID(N'dbo.TblFinInsightSnapshot', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblFinInsightSnapshot (
    ID bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
    TenantId uniqueidentifier NOT NULL,
    ScopeKey nvarchar(200) NOT NULL,
    AsOfDate date NOT NULL,
    Payload nvarchar(max) NOT NULL,
    CreatedByUserID int NULL,
    CreatedAt datetime2(3) NOT NULL CONSTRAINT DF_FinInsightSnapshotCreatedAt DEFAULT (sysutcdatetime()),
    CONSTRAINT UQ_FinInsightSnapshotScopeDay UNIQUE (TenantId, ScopeKey, AsOfDate)
  );
END;

COMMIT TRANSACTION;

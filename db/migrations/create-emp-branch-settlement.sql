/*
  Inter-branch employee settlement (تسوية مستحقات الموظفين بين الفروع).

  Stores settlement header + links to paired ledger entries and optional cash moves.
  Ledger EntryReason remains existing `settlement` (already in CK).
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.TblEmpBranchSettlement', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblEmpBranchSettlement (
    SettlementID           BIGINT IDENTITY(1,1) NOT NULL
      CONSTRAINT PK_TblEmpBranchSettlement PRIMARY KEY,
    EmpID                  INT NOT NULL,
    SourceBranchID         INT NOT NULL,
    DestBranchID           INT NOT NULL,
    Amount                 DECIMAL(12, 2) NOT NULL
      CONSTRAINT CK_TblEmpBranchSettlement_Amount CHECK (Amount > 0),
    SettlementType         NVARCHAR(40) NOT NULL
      CONSTRAINT CK_TblEmpBranchSettlement_Type CHECK (
        SettlementType IN (N'cash_transfer', N'ledger_only')
      ),
    SettlementDate         DATE NOT NULL,
    Notes                  NVARCHAR(500) NULL,
    SourceCashMoveID       INT NULL,
    DestCashMoveID         INT NULL,
    SourceLedgerEntryID    INT NULL,
    DestLedgerEntryID      INT NULL,
    SourceBusinessDayID    INT NULL,
    DestBusinessDayID      INT NULL,
    IdempotencyKey         NVARCHAR(80) NULL,
    IsVoided               BIT NOT NULL
      CONSTRAINT DF_TblEmpBranchSettlement_IsVoided DEFAULT (0),
    VoidReason             NVARCHAR(500) NULL,
    VoidedAt               DATETIME2(0) NULL,
    VoidedByUserID         INT NULL,
    ReversalOfSettlementID BIGINT NULL,
    CreatedByUserID        INT NULL,
    CreatedAt              DATETIME2(0) NOT NULL
      CONSTRAINT DF_TblEmpBranchSettlement_CreatedAt DEFAULT (SYSDATETIME()),
    CONSTRAINT FK_TblEmpBranchSettlement_Emp
      FOREIGN KEY (EmpID) REFERENCES dbo.TblEmp (EmpID),
    CONSTRAINT FK_TblEmpBranchSettlement_SourceBranch
      FOREIGN KEY (SourceBranchID) REFERENCES dbo.TblBranch (BranchID),
    CONSTRAINT FK_TblEmpBranchSettlement_DestBranch
      FOREIGN KEY (DestBranchID) REFERENCES dbo.TblBranch (BranchID),
    CONSTRAINT CK_TblEmpBranchSettlement_BranchesDiff
      CHECK (SourceBranchID <> DestBranchID)
  );

  CREATE UNIQUE INDEX UX_TblEmpBranchSettlement_Idempotency
    ON dbo.TblEmpBranchSettlement (IdempotencyKey)
    WHERE IdempotencyKey IS NOT NULL;

  CREATE INDEX IX_TblEmpBranchSettlement_EmpDate
    ON dbo.TblEmpBranchSettlement (EmpID, SettlementDate DESC, SettlementID DESC);

  CREATE INDEX IX_TblEmpBranchSettlement_Active
    ON dbo.TblEmpBranchSettlement (EmpID, IsVoided, SettlementDate DESC);

  PRINT N'Created dbo.TblEmpBranchSettlement';
END
ELSE
  PRINT N'dbo.TblEmpBranchSettlement already exists';
GO

-- Cash categories for physical till transfer (P&L-neutral via transfer classification)
IF NOT EXISTS (
  SELECT 1 FROM dbo.TblExpINCat
  WHERE CatName = N'تحويل تسوية مستحقات موظف' AND ExpINType = N'مصروفات'
)
BEGIN
  INSERT INTO dbo.TblExpINCat (CatName, ExpINType)
  VALUES (N'تحويل تسوية مستحقات موظف', N'مصروفات');
  PRINT N'Created expense category: تحويل تسوية مستحقات موظف';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM dbo.TblExpINCat
  WHERE CatName = N'تحويل تسوية مستحقات موظف' AND ExpINType = N'ايرادات'
)
BEGIN
  INSERT INTO dbo.TblExpINCat (CatName, ExpINType)
  VALUES (N'تحويل تسوية مستحقات موظف', N'ايرادات');
  PRINT N'Created income category: تحويل تسوية مستحقات موظف';
END
GO

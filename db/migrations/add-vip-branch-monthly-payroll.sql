-- VIP per-branch monthly compensation. Run after add-employee-financial-branch-ownership.sql.
-- Idempotent and non-destructive to payroll history.
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF COL_LENGTH(N'dbo.TblEmp', N'PayrollScope') IS NULL
BEGIN
  ALTER TABLE dbo.TblEmp ADD PayrollScope NVARCHAR(20) NOT NULL
    CONSTRAINT DF_TblEmp_PayrollScope DEFAULT (N'global') WITH VALUES;
END;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_TblEmp_PayrollScope')
BEGIN
  ALTER TABLE dbo.TblEmp WITH CHECK ADD CONSTRAINT CK_TblEmp_PayrollScope
    CHECK (PayrollScope IN (N'global', N'branch_monthly'));
END;

IF OBJECT_ID(N'dbo.TblEmpBranchPayrollAudit', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblEmpBranchPayrollAudit (
    AuditID BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    EmpID INT NOT NULL REFERENCES dbo.TblEmp(EmpID),
    EffectiveFrom DATE NOT NULL,
    OldPayrollScope NVARCHAR(20) NOT NULL,
    NewPayrollScope NVARCHAR(20) NOT NULL,
    BeforeJson NVARCHAR(MAX) NULL,
    AfterJson NVARCHAR(MAX) NOT NULL,
    ChangedByUserID INT NOT NULL REFERENCES dbo.TblUser(UserID),
    ChangedAt DATETIME2(0) NOT NULL DEFAULT (SYSUTCDATETIME())
  );
  CREATE INDEX IX_TblEmpBranchPayrollAudit_Emp ON dbo.TblEmpBranchPayrollAudit(EmpID, ChangedAt DESC);
END;

-- The former uniqueness by (RefType,RefID,EntryReason) incorrectly prevents
-- posting the same person's monthly entitlement at two different branches.
-- Keep duplicate prevention *within each branch* for all reference types.
IF OBJECT_ID(N'dbo.TblEmpLedgerEntry', N'U') IS NOT NULL
BEGIN
  IF COL_LENGTH(N'dbo.TblEmpLedgerEntry', N'BranchID') IS NULL
    THROW 51001, 'Branch-owned employee ledger migration is required first.', 1;

  IF EXISTS (
    SELECT 1 FROM dbo.TblEmpLedgerEntry
    WHERE IsVoided = 0 AND RefType IS NOT NULL AND RefID IS NOT NULL
    GROUP BY RefType, RefID, EntryReason, BranchID HAVING COUNT_BIG(*) > 1
  )
    THROW 51002, 'Duplicate active employee ledger references must be reconciled before installing index.', 1;

  IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.TblEmpLedgerEntry')
      AND name = N'UX_TblEmpLedgerEntry_ActiveRefReason'
  )
    DROP INDEX UX_TblEmpLedgerEntry_ActiveRefReason ON dbo.TblEmpLedgerEntry;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.TblEmpLedgerEntry')
      AND name = N'UX_TblEmpLedgerEntry_ActiveRefReason_Branch'
  )
    CREATE UNIQUE NONCLUSTERED INDEX UX_TblEmpLedgerEntry_ActiveRefReason_Branch
      ON dbo.TblEmpLedgerEntry (RefType, RefID, EntryReason, BranchID)
      WHERE IsVoided = 0 AND RefType IS NOT NULL AND RefID IS NOT NULL;
END;

COMMIT TRANSACTION;

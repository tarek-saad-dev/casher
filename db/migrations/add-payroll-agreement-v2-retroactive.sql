-- Payroll Agreements V2: historical payroll corrections must remain auditable.
-- Apply to last132 only after an off-host verified backup and staging rehearsal.
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF DB_NAME() NOT IN (N'last132', N'last132_agent')
    THROW 51001, 'Payroll Agreements V2 requires explicitly named staging or production database', 1;
GO
IF OBJECT_ID(N'dbo.TblEmpBranchPayrollPlan', N'U') IS NULL
    OR OBJECT_ID(N'dbo.TblEmpDailyPayroll', N'U') IS NULL
    OR OBJECT_ID(N'dbo.TblEmpLedgerEntry', N'U') IS NULL
    OR OBJECT_ID(N'dbo.TblEmpBranchPayrollAudit', N'U') IS NULL
    THROW 51002, 'Existing financial branch payroll schema is required', 1;
GO
IF OBJECT_ID(N'dbo.TblEmpPayrollAgreementRevision', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TblEmpPayrollAgreementRevision (
        RevisionID BIGINT IDENTITY(1,1) NOT NULL
            CONSTRAINT PK_TblEmpPayrollAgreementRevision PRIMARY KEY,
        EmpID INT NOT NULL
            CONSTRAINT FK_TblEmpPayrollAgreementRevision_Emp REFERENCES dbo.TblEmp(EmpID),
        RequestKey NVARCHAR(80) NOT NULL,
        EffectiveFrom DATE NOT NULL,
        NewScope NVARCHAR(20) NOT NULL,
        AgreementJson NVARCHAR(MAX) NOT NULL,
        BeforeJson NVARCHAR(MAX) NOT NULL,
        ImpactJson NVARCHAR(MAX) NOT NULL,
        ReversedDailyCount INT NOT NULL,
        ReversedDailyAmount DECIMAL(14,2) NOT NULL,
        CreatedByUserID INT NULL,
        CreatedAt DATETIME2(0) NOT NULL
            CONSTRAINT DF_TblEmpPayrollAgreementRevision_CreatedAt DEFAULT (SYSDATETIME()),
        CONSTRAINT UX_TblEmpPayrollAgreementRevision_RequestKey UNIQUE (RequestKey),
        CONSTRAINT CK_TblEmpPayrollAgreementRevision_Scope CHECK (NewScope IN (N'global', N'branch_monthly'))
    );
    CREATE INDEX IX_TblEmpPayrollAgreementRevision_EmpDate
        ON dbo.TblEmpPayrollAgreementRevision(EmpID, EffectiveFrom DESC);
END;
GO
IF COL_LENGTH(N'dbo.TblEmpDailyPayroll', N'SupersededByPayrollRevisionID') IS NULL
    ALTER TABLE dbo.TblEmpDailyPayroll ADD SupersededByPayrollRevisionID BIGINT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys
               WHERE name = N'FK_TblEmpDailyPayroll_PayrollRevision')
    ALTER TABLE dbo.TblEmpDailyPayroll
        ADD CONSTRAINT FK_TblEmpDailyPayroll_PayrollRevision
        FOREIGN KEY (SupersededByPayrollRevisionID)
        REFERENCES dbo.TblEmpPayrollAgreementRevision(RevisionID);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE object_id = OBJECT_ID(N'dbo.TblEmpDailyPayroll')
                 AND name = N'IX_TblEmpDailyPayroll_ActiveAgreement')
    CREATE INDEX IX_TblEmpDailyPayroll_ActiveAgreement
        ON dbo.TblEmpDailyPayroll(EmpID, WorkDate, BranchID)
        INCLUDE (DailyWage, Status, SupersededByPayrollRevisionID);
GO
PRINT N'Payroll Agreements V2 schema ready';

-- ============================================================
-- Automatic employee late deduction system
-- Idempotent — safe to re-run.
-- Does NOT backfill historical attendance into deductions.
-- ============================================================

IF COL_LENGTH(N'dbo.TblEmp', N'LateDeductionExempt') IS NULL
BEGIN
  ALTER TABLE dbo.TblEmp
    ADD LateDeductionExempt BIT NOT NULL
      CONSTRAINT DF_TblEmp_LateDeductionExempt DEFAULT (0);
  PRINT 'Added TblEmp.LateDeductionExempt';
END
ELSE
  PRINT 'TblEmp.LateDeductionExempt already exists';
GO

IF OBJECT_ID(N'dbo.TblHrFeatureSetting', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblHrFeatureSetting (
    SettingKey   NVARCHAR(80)  NOT NULL,
    SettingValue NVARCHAR(200) NULL,
    UpdatedAt    DATETIME2     NOT NULL
      CONSTRAINT DF_TblHrFeatureSetting_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedByUserID INT NULL,
    CONSTRAINT PK_TblHrFeatureSetting PRIMARY KEY (SettingKey)
  );
  PRINT 'Created TblHrFeatureSetting';
END
ELSE
  PRINT 'TblHrFeatureSetting already exists';
GO

IF OBJECT_ID(N'dbo.TblEmpLateDeductionCase', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblEmpLateDeductionCase (
    CaseID              INT IDENTITY(1,1) NOT NULL,
    EmpID               INT NOT NULL,
    BranchID            INT NOT NULL,
    WorkDate            DATE NOT NULL,
    AttendanceID        INT NULL,
    ScheduledStartTime  TIME NULL,
    ScheduledEndTime    TIME NULL,
    LateMinutes         INT NOT NULL
      CONSTRAINT DF_LateDeductionCase_LateMinutes DEFAULT (0),
    DeductionKind       NVARCHAR(30) NOT NULL,
    Status              NVARCHAR(30) NOT NULL,
    DailyBasePay        DECIMAL(12,2) NULL,
    Amount              DECIMAL(12,2) NULL,
    LedgerEntryID       INT NULL,
    NotifiedAt1         DATETIME2 NULL,
    NotifiedAt61        DATETIME2 NULL,
    NotifiedAt121       DATETIME2 NULL,
    NotifiedFinalAt     DATETIME2 NULL,
    ManagerNotes        NVARCHAR(500) NULL,
    ManagerDecidedBy    INT NULL,
    ManagerDecidedAt    DATETIME2 NULL,
    CancelReason        NVARCHAR(500) NULL,
    CancelledBy         INT NULL,
    CancelledAt         DATETIME2 NULL,
    DoNotAutoRecreate   BIT NOT NULL
      CONSTRAINT DF_LateDeductionCase_DoNotAutoRecreate DEFAULT (0),
    CreatedAt           DATETIME2 NOT NULL
      CONSTRAINT DF_LateDeductionCase_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt           DATETIME2 NULL,
    CONSTRAINT PK_TblEmpLateDeductionCase PRIMARY KEY (CaseID),
    CONSTRAINT UQ_TblEmpLateDeductionCase_Emp_Branch_WorkDate
      UNIQUE (EmpID, BranchID, WorkDate)
  );

  CREATE INDEX IX_TblEmpLateDeductionCase_Status_WorkDate
    ON dbo.TblEmpLateDeductionCase (Status, WorkDate);

  CREATE INDEX IX_TblEmpLateDeductionCase_AttendanceID
    ON dbo.TblEmpLateDeductionCase (AttendanceID)
    WHERE AttendanceID IS NOT NULL;

  PRINT 'Created TblEmpLateDeductionCase';
END
ELSE
  PRINT 'TblEmpLateDeductionCase already exists';
GO

PRINT 'Late deduction migration complete';
GO

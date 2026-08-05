-- Phase 3A: Canonical daily adjustment model
-- Idempotent: safe to re-run.

IF OBJECT_ID(N'dbo.TblEmpDailyAdjustment', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblEmpDailyAdjustment (
    AdjustmentID   BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_TblEmpDailyAdjustment PRIMARY KEY,
    BranchID       INT NOT NULL,
    EmpID          INT NOT NULL,
    BusinessDate   DATE NOT NULL,
    AdjustmentType VARCHAR(32) NOT NULL,
    ReasonCode     VARCHAR(64) NULL,
    ReasonText     NVARCHAR(500) NULL,
    Source         VARCHAR(32) NOT NULL,
    IsActive       BIT NOT NULL CONSTRAINT DF_TblEmpDailyAdjustment_IsActive DEFAULT (1),
    CreatedBy      INT NULL,
    CreatedAt      DATETIME2 NOT NULL CONSTRAINT DF_TblEmpDailyAdjustment_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedBy      INT NULL,
    UpdatedAt      DATETIME2 NULL,
    CancelledBy    INT NULL,
    CancelledAt    DATETIME2 NULL,
    Version        INT NOT NULL CONSTRAINT DF_TblEmpDailyAdjustment_Version DEFAULT (1),
    CONSTRAINT CK_TblEmpDailyAdjustment_Type CHECK (
      AdjustmentType IN ('CLOSE_DAY', 'REPLACE_WINDOWS', 'ADD_WINDOW', 'BLOCK_WINDOW')
    ),
    CONSTRAINT CK_TblEmpDailyAdjustment_Source CHECK (
      Source IN ('admin', 'operations', 'attendance', 'migration', 'system')
    )
  );

  CREATE NONCLUSTERED INDEX IX_TblEmpDailyAdjustment_Branch_Emp_Date_Active
    ON dbo.TblEmpDailyAdjustment (BranchID, EmpID, BusinessDate, IsActive)
    INCLUDE (AdjustmentType, CreatedAt, Version, CancelledAt);

  CREATE NONCLUSTERED INDEX IX_TblEmpDailyAdjustment_Branch_Date_Active
    ON dbo.TblEmpDailyAdjustment (BranchID, BusinessDate, IsActive)
    INCLUDE (EmpID, AdjustmentType, CreatedAt);
END;
GO

IF OBJECT_ID(N'dbo.TblEmpDailyAdjustmentWindow', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblEmpDailyAdjustmentWindow (
    AdjustmentWindowID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_TblEmpDailyAdjustmentWindow PRIMARY KEY,
    AdjustmentID       BIGINT NOT NULL,
    StartTime          TIME NOT NULL,
    EndTime            TIME NOT NULL,
    EndDayOffset       TINYINT NOT NULL CONSTRAINT DF_TblEmpDailyAdjWin_EndDayOffset DEFAULT (0),
    SortOrder          INT NOT NULL CONSTRAINT DF_TblEmpDailyAdjWin_SortOrder DEFAULT (0),
    CreatedAt          DATETIME2 NOT NULL CONSTRAINT DF_TblEmpDailyAdjWin_CreatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT FK_TblEmpDailyAdjustmentWindow_Adj
      FOREIGN KEY (AdjustmentID) REFERENCES dbo.TblEmpDailyAdjustment (AdjustmentID),
    CONSTRAINT CK_TblEmpDailyAdjWin_EndDayOffset CHECK (EndDayOffset IN (0, 1))
  );

  CREATE NONCLUSTERED INDEX IX_TblEmpDailyAdjustmentWindow_Adj_Sort
    ON dbo.TblEmpDailyAdjustmentWindow (AdjustmentID, SortOrder)
    INCLUDE (StartTime, EndTime, EndDayOffset);
END;
GO

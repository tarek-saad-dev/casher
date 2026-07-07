-- =============================================
-- Accounting classification settings (admin-controlled, read-only audit)
-- Does NOT modify TblCashMove or create TblCashMoveClassification
--
-- NOTE: This file is reference documentation only.
-- Runtime migration runs via src/lib/accounting/accountingSettingsMigration.ts
-- using one query() per step (never split by semicolon or GO).
-- =============================================

IF OBJECT_ID(N'dbo.TblAccountingCategoryClassificationMap', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblAccountingCategoryClassificationMap (
    ID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    ExpINID INT NOT NULL,
    FlowGroup NVARCHAR(80) NOT NULL,
    FlowKind NVARCHAR(80) NOT NULL,
    PnlImpact NVARCHAR(30) NOT NULL,
    PartyType NVARCHAR(40) NOT NULL,
    RequiresEmployee BIT NOT NULL CONSTRAINT DF_AccCatMap_RequiresEmployee DEFAULT 0,
    NeedsReviewByDefault BIT NOT NULL CONSTRAINT DF_AccCatMap_NeedsReview DEFAULT 0,
    Confidence NVARCHAR(10) NOT NULL CONSTRAINT DF_AccCatMap_Confidence DEFAULT N'high',
    Notes NVARCHAR(500) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_AccCatMap_IsActive DEFAULT 1,
    CreatedByUserID INT NULL,
    UpdatedByUserID INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_AccCatMap_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_AccCatMap_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_AccCatMap_ExpINID FOREIGN KEY (ExpINID) REFERENCES dbo.TblExpINCat(ExpINID),
    CONSTRAINT UQ_AccCatMap_ExpINID UNIQUE (ExpINID)
  )
END
GO

IF OBJECT_ID(N'dbo.TblAccountingCategoryClassificationMap', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_AccCatMap_IsActive'
      AND object_id = OBJECT_ID(N'dbo.TblAccountingCategoryClassificationMap')
  )
BEGIN
  CREATE INDEX IX_AccCatMap_IsActive
    ON dbo.TblAccountingCategoryClassificationMap(IsActive)
    WHERE IsActive = 1
END
GO

IF OBJECT_ID(N'dbo.TblAccountingKeywordClassificationRule', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblAccountingKeywordClassificationRule (
    ID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    Keyword NVARCHAR(200) NOT NULL,
    MatchTarget NVARCHAR(20) NOT NULL,
    MatchMode NVARCHAR(20) NOT NULL,
    FlowGroup NVARCHAR(80) NOT NULL,
    FlowKind NVARCHAR(80) NOT NULL,
    PnlImpact NVARCHAR(30) NOT NULL,
    PartyType NVARCHAR(40) NOT NULL,
    RequiresEmployee BIT NOT NULL CONSTRAINT DF_AccKwRule_RequiresEmployee DEFAULT 0,
    NeedsReviewByDefault BIT NOT NULL CONSTRAINT DF_AccKwRule_NeedsReview DEFAULT 0,
    Confidence NVARCHAR(10) NOT NULL CONSTRAINT DF_AccKwRule_Confidence DEFAULT N'high',
    Priority INT NOT NULL CONSTRAINT DF_AccKwRule_Priority DEFAULT 100,
    IsActive BIT NOT NULL CONSTRAINT DF_AccKwRule_IsActive DEFAULT 1,
    CreatedByUserID INT NULL,
    UpdatedByUserID INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_AccKwRule_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_AccKwRule_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CHK_AccKwRule_MatchTarget CHECK (MatchTarget IN (N'category', N'notes', N'both')),
    CONSTRAINT CHK_AccKwRule_MatchMode CHECK (MatchMode IN (N'contains', N'exact'))
  )
END
GO

IF OBJECT_ID(N'dbo.TblAccountingKeywordClassificationRule', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_AccKwRule_Priority'
      AND object_id = OBJECT_ID(N'dbo.TblAccountingKeywordClassificationRule')
  )
BEGIN
  CREATE INDEX IX_AccKwRule_Priority
    ON dbo.TblAccountingKeywordClassificationRule(Priority, IsActive)
END
GO

IF OBJECT_ID(N'dbo.TblAccountingEmployeeAlias', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblAccountingEmployeeAlias (
    ID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    EmpID INT NOT NULL,
    AliasText NVARCHAR(200) NOT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_AccEmpAlias_IsActive DEFAULT 1,
    CreatedByUserID INT NULL,
    UpdatedByUserID INT NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_AccEmpAlias_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_AccEmpAlias_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_AccEmpAlias_EmpID FOREIGN KEY (EmpID) REFERENCES dbo.TblEmp(EmpID)
  )
END
GO

IF OBJECT_ID(N'dbo.TblAccountingEmployeeAlias', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_AccEmpAlias_AliasText'
      AND object_id = OBJECT_ID(N'dbo.TblAccountingEmployeeAlias')
  )
BEGIN
  CREATE INDEX IX_AccEmpAlias_AliasText
    ON dbo.TblAccountingEmployeeAlias(AliasText)
    WHERE IsActive = 1
END
GO

IF OBJECT_ID(N'dbo.TblAccountingEmployeeAlias', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_AccEmpAlias_EmpID'
      AND object_id = OBJECT_ID(N'dbo.TblAccountingEmployeeAlias')
  )
BEGIN
  CREATE INDEX IX_AccEmpAlias_EmpID
    ON dbo.TblAccountingEmployeeAlias(EmpID)
    WHERE IsActive = 1
END
GO

PRINT 'Accounting classification settings tables ready';

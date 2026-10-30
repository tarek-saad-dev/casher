-- CUT Pulse draft-only storage. Explicit migration; never run automatically on GET.
IF OBJECT_ID('dbo.TblCutPulseAutomationDraft','U') IS NULL
BEGIN
  CREATE TABLE dbo.TblCutPulseAutomationDraft (
    ID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    TenantId NVARCHAR(100) NOT NULL,
    BranchID INT NOT NULL,
    CreatedByUserID INT NOT NULL,
    Name NVARCHAR(160) NOT NULL,
    DefinitionJson NVARCHAR(MAX) NOT NULL,
    Version INT NOT NULL CONSTRAINT DF_CutPulseDraftVersion DEFAULT (1),
    Status NVARCHAR(20) NOT NULL CONSTRAINT DF_CutPulseDraftStatus DEFAULT (N'draft'),
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_CutPulseDraftCreated DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_CutPulseDraftUpdated DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_CutPulseDraftStatus CHECK (Status IN (N'draft',N'active',N'paused'))
  );
  CREATE INDEX IX_CutPulseDraftScope ON dbo.TblCutPulseAutomationDraft(TenantId, BranchID, CreatedByUserID);
END;

-- Event journal records idempotent facts without sending any WhatsApp.
IF OBJECT_ID('dbo.TblCutPulseAutomationEvent','U') IS NULL
BEGIN
 CREATE TABLE dbo.TblCutPulseAutomationEvent (
 ID BIGINT IDENTITY(1,1) PRIMARY KEY,
 TenantId NVARCHAR(100) NOT NULL,
 BranchID INT NOT NULL,
 EventKey NVARCHAR(160) NOT NULL,
 EventType NVARCHAR(100) NOT NULL,
 FactsJson NVARCHAR(MAX) NOT NULL,
 CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT UQ_CutPulseAutomationEvent UNIQUE(TenantId,BranchID,EventKey)
 );
END;
IF OBJECT_ID('dbo.TblCutPulseAutomationRun','U') IS NULL
BEGIN
 CREATE TABLE dbo.TblCutPulseAutomationRun (
 ID BIGINT IDENTITY(1,1) PRIMARY KEY,
 TenantId NVARCHAR(100) NOT NULL,
 BranchID INT NOT NULL,
 AutomationID INT NOT NULL,
 EventID BIGINT NOT NULL,
 Matched BIT NOT NULL,
 Status NVARCHAR(30) NOT NULL DEFAULT N'evaluated_only',
 DecisionJson NVARCHAR(MAX) NOT NULL,
 CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT UQ_CutPulseAutomationRun UNIQUE (AutomationID,EventID)
 );
END;

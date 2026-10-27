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
    CONSTRAINT CK_CutPulseDraftStatus CHECK (Status = N'draft')
  );
  CREATE INDEX IX_CutPulseDraftScope ON dbo.TblCutPulseAutomationDraft(TenantId, BranchID, CreatedByUserID);
END;

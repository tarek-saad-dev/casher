-- Idempotent migration: create TblSensitiveActionAuditLog
-- Approval workflow retired and replaced by audit-only workflow
-- Safe to run multiple times

IF NOT EXISTS (
  SELECT 1 FROM sys.objects
  WHERE object_id = OBJECT_ID(N'dbo.TblSensitiveActionAuditLog') AND type = 'U'
)
BEGIN
  CREATE TABLE dbo.TblSensitiveActionAuditLog (
    AuditID              BIGINT IDENTITY(1,1) PRIMARY KEY,
    ActionType           NVARCHAR(100)  NOT NULL,
    ActionLabel          NVARCHAR(200)  NULL,
    EntityType           NVARCHAR(100)  NULL,
    EntityID             NVARCHAR(200)  NULL,

    PerformedByUserID    INT            NULL,
    PerformedByUserName  NVARCHAR(100)  NULL,
    UserRolesSnapshot    NVARCHAR(MAX)  NULL,

    ActionMethod         NVARCHAR(20)   NULL,
    EndpointPath         NVARCHAR(300)  NULL,

    OldData              NVARCHAR(MAX)  NULL,
    NewData              NVARCHAR(MAX)  NULL,
    ChangedFields        NVARCHAR(MAX)  NULL,

    Reason               NVARCHAR(500)  NULL,
    RiskLevel            NVARCHAR(30)   NULL,

    RequestID            NVARCHAR(100)  NULL,
    IPAddress            NVARCHAR(100)  NULL,
    UserAgent            NVARCHAR(500)  NULL,

    ExecutionStatus      NVARCHAR(30)   NOT NULL,
    ErrorMessage         NVARCHAR(MAX)  NULL,

    CreatedAt            DATETIME2      NOT NULL DEFAULT GETDATE()
  );

  CREATE INDEX IX_SensitiveAuditLog_CreatedAt           ON dbo.TblSensitiveActionAuditLog (CreatedAt DESC);
  CREATE INDEX IX_SensitiveAuditLog_PerformedByUserID ON dbo.TblSensitiveActionAuditLog (PerformedByUserID);
  CREATE INDEX IX_SensitiveAuditLog_ActionType          ON dbo.TblSensitiveActionAuditLog (ActionType);
  CREATE INDEX IX_SensitiveAuditLog_EntityType_EntityID ON dbo.TblSensitiveActionAuditLog (EntityType, EntityID);
  CREATE INDEX IX_SensitiveAuditLog_ExecutionStatus     ON dbo.TblSensitiveActionAuditLog (ExecutionStatus);
  CREATE INDEX IX_SensitiveAuditLog_RiskLevel           ON dbo.TblSensitiveActionAuditLog (RiskLevel);
  CREATE INDEX IX_SensitiveAuditLog_RequestID           ON dbo.TblSensitiveActionAuditLog (RequestID);
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.objects
  WHERE object_id = OBJECT_ID(N'dbo.TblApprovalWorkflowStatus') AND type = 'U'
)
BEGIN
  CREATE TABLE dbo.TblApprovalWorkflowStatus (
    StatusID      INT IDENTITY(1,1) PRIMARY KEY,
    StatusKey     NVARCHAR(50)  NOT NULL,
    StatusValue   NVARCHAR(500) NULL,
    CreatedAt     DATETIME2     NOT NULL DEFAULT GETDATE()
  );

  INSERT INTO dbo.TblApprovalWorkflowStatus (StatusKey, StatusValue)
  VALUES (N'retirement_note', N'Approval workflow retired and replaced by audit-only workflow');
END;

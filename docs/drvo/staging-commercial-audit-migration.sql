/* STAGING ONLY: commercial entitlement audit/idempotency schema.
 * Manual execution after backup review; NOT wired to startup or CI.
 * No existing entitlements are changed.
 */
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() <> N'last132_agent' THROW 51301, 'STAGING_ONLY', 1;
IF SUSER_SNAME() <> N'drvo_agent' THROW 51302, 'UNEXPECTED_LOGIN', 1;
IF ISNULL(HAS_DBACCESS(N'last132'), 1) <> 0 THROW 51303, 'PRODUCTION_ISOLATION_FAILED', 1;
IF OBJECT_ID(N'dbo.DrvoTenantModuleEntitlement', N'U') IS NULL
  OR OBJECT_ID(N'dbo.DrvoPlatformOperatorGrant', N'U') IS NULL
  THROW 51304, 'REQUIRED_SCHEMA_MISSING', 1;
IF OBJECT_ID(N'dbo.DrvoModuleEntitlementAudit', N'U') IS NOT NULL
  THROW 51305, 'AUDIT_SCHEMA_ALREADY_EXISTS', 1;

BEGIN TRY
  BEGIN TRANSACTION;
  CREATE TABLE dbo.DrvoModuleEntitlementAudit (
    RequestId UNIQUEIDENTIFIER NOT NULL,
    TenantId UNIQUEIDENTIFIER NOT NULL,
    ModuleKey NVARCHAR(64) NOT NULL,
    Action NVARCHAR(16) NOT NULL,
    ActorUserId INT NOT NULL,
    PreviousStatus NVARCHAR(16) NULL,
    PreviousValidUntilUtc DATETIME2(3) NULL,
    NewStatus NVARCHAR(16) NOT NULL,
    NewValidUntilUtc DATETIME2(3) NULL,
    CreatedAtUtc DATETIME2(3) NOT NULL
      CONSTRAINT DF_DrvoModuleEntitlementAudit_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_DrvoModuleEntitlementAudit PRIMARY KEY (RequestId),
    CONSTRAINT FK_DrvoModuleEntitlementAudit_Tenant FOREIGN KEY (TenantId)
      REFERENCES dbo.Tenant(TenantId),
    CONSTRAINT CK_DrvoModuleEntitlementAudit_Action
      CHECK (Action IN (N'provision', N'suspend', N'renew', N'cancel')),
    CONSTRAINT CK_DrvoModuleEntitlementAudit_Status
      CHECK (NewStatus IN (N'enabled', N'suspended', N'disabled'))
  );
  CREATE INDEX IX_DrvoModuleEntitlementAudit_Tenant_Created
    ON dbo.DrvoModuleEntitlementAudit(TenantId, CreatedAtUtc DESC);
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
PRINT 'DRVO_COMMERCIAL_AUDIT_SCHEMA_APPLIED';

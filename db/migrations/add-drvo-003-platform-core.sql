/*
  DRVO-003 Platform Core Bootstrap — staging only (last132_agent).
  Creates Tenant, Location, LegacyIdMap, TenantMembership, PlatformOutbox,
  AppRegistry, TenantAppEntitlement, SalonPackConfig.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID(N'dbo.Tenant', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.Tenant (
      TenantId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Tenant_TenantId DEFAULT NEWSEQUENTIALID(),
      Code NVARCHAR(64) NOT NULL,
      Name NVARCHAR(256) NOT NULL,
      Status NVARCHAR(20) NOT NULL CONSTRAINT DF_Tenant_Status DEFAULT N'active',
      DefaultTimezone NVARCHAR(64) NOT NULL CONSTRAINT DF_Tenant_TZ DEFAULT N'Africa/Cairo',
      CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Tenant_CreatedAt DEFAULT SYSUTCDATETIME(),
      UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_Tenant_UpdatedAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_Tenant PRIMARY KEY (TenantId),
      CONSTRAINT UQ_Tenant_Code UNIQUE (Code),
      CONSTRAINT CK_Tenant_Status CHECK (Status IN (N'active', N'suspended'))
    );
  END;

  IF OBJECT_ID(N'dbo.Location', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.Location (
      LocationId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Location_LocationId DEFAULT NEWSEQUENTIALID(),
      TenantId UNIQUEIDENTIFIER NOT NULL,
      LegacyBranchId INT NOT NULL,
      BranchCode NVARCHAR(64) NOT NULL,
      Timezone NVARCHAR(64) NOT NULL CONSTRAINT DF_Location_TZ DEFAULT N'Africa/Cairo',
      Status NVARCHAR(20) NOT NULL CONSTRAINT DF_Location_Status DEFAULT N'active',
      CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Location_CreatedAt DEFAULT SYSUTCDATETIME(),
      UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_Location_UpdatedAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_Location PRIMARY KEY (LocationId),
      CONSTRAINT FK_Location_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId),
      CONSTRAINT UQ_Location_Tenant_BranchCode UNIQUE (TenantId, BranchCode),
      CONSTRAINT UQ_Location_Tenant_LegacyBranchId UNIQUE (TenantId, LegacyBranchId),
      CONSTRAINT CK_Location_Status CHECK (Status IN (N'active', N'suspended'))
    );
  END;

  IF OBJECT_ID(N'dbo.LegacyIdMap', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.LegacyIdMap (
      TenantId UNIQUEIDENTIFIER NOT NULL,
      EntityName NVARCHAR(64) NOT NULL,
      LegacyKey NVARCHAR(128) NOT NULL,
      DrvoId UNIQUEIDENTIFIER NOT NULL,
      CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegacyIdMap_CreatedAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_LegacyIdMap PRIMARY KEY (TenantId, EntityName, LegacyKey),
      CONSTRAINT FK_LegacyIdMap_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId)
    );
  END;

  IF OBJECT_ID(N'dbo.TenantMembership', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.TenantMembership (
      MembershipId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_TenantMembership_Id DEFAULT NEWSEQUENTIALID(),
      TenantId UNIQUEIDENTIFIER NOT NULL,
      LegacyUserId INT NOT NULL,
      CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_TenantMembership_CreatedAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_TenantMembership PRIMARY KEY (MembershipId),
      CONSTRAINT FK_TenantMembership_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId),
      CONSTRAINT UQ_TenantMembership_Tenant_User UNIQUE (TenantId, LegacyUserId)
    );
  END;

  IF OBJECT_ID(N'dbo.PlatformOutbox', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.PlatformOutbox (
      Id BIGINT IDENTITY(1,1) NOT NULL,
      TenantId UNIQUEIDENTIFIER NOT NULL,
      AggregateType NVARCHAR(64) NOT NULL,
      AggregateId NVARCHAR(128) NOT NULL,
      EventType NVARCHAR(128) NOT NULL,
      Payload NVARCHAR(MAX) NOT NULL,
      IdempotencyKey NVARCHAR(256) NULL,
      OccurredAt DATETIME2 NOT NULL,
      Status NVARCHAR(20) NOT NULL CONSTRAINT DF_PlatformOutbox_Status DEFAULT N'pending',
      Attempts INT NOT NULL CONSTRAINT DF_PlatformOutbox_Attempts DEFAULT 0,
      CorrelationId NVARCHAR(128) NULL,
      CONSTRAINT PK_PlatformOutbox PRIMARY KEY (Id),
      CONSTRAINT FK_PlatformOutbox_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId),
      CONSTRAINT CK_PlatformOutbox_Status CHECK (Status IN (N'pending', N'delivering', N'delivered', N'dead'))
    );

    CREATE UNIQUE INDEX UX_PlatformOutbox_Tenant_Idempotency
      ON dbo.PlatformOutbox (TenantId, IdempotencyKey)
      WHERE IdempotencyKey IS NOT NULL;
  END;

  IF OBJECT_ID(N'dbo.AppRegistry', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.AppRegistry (
      AppCode NVARCHAR(64) NOT NULL,
      DisplayName NVARCHAR(256) NOT NULL,
      EntitledSeparately BIT NOT NULL CONSTRAINT DF_AppRegistry_Entitled DEFAULT 1,
      CONSTRAINT PK_AppRegistry PRIMARY KEY (AppCode)
    );
  END;

  IF OBJECT_ID(N'dbo.TenantAppEntitlement', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.TenantAppEntitlement (
      TenantId UNIQUEIDENTIFIER NOT NULL,
      AppCode NVARCHAR(64) NOT NULL,
      Enabled BIT NOT NULL CONSTRAINT DF_TenantAppEntitlement_Enabled DEFAULT 1,
      CONSTRAINT PK_TenantAppEntitlement PRIMARY KEY (TenantId, AppCode),
      CONSTRAINT FK_TenantAppEntitlement_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId),
      CONSTRAINT FK_TenantAppEntitlement_App FOREIGN KEY (AppCode) REFERENCES dbo.AppRegistry (AppCode)
    );
  END;

  IF OBJECT_ID(N'dbo.SalonPackConfig', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.SalonPackConfig (
      TenantId UNIQUEIDENTIFIER NOT NULL,
      PackCode NVARCHAR(64) NOT NULL CONSTRAINT DF_SalonPackConfig_Pack DEFAULT N'salon',
      ManifestJson NVARCHAR(MAX) NOT NULL,
      UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_SalonPackConfig_UpdatedAt DEFAULT SYSUTCDATETIME(),
      CONSTRAINT PK_SalonPackConfig PRIMARY KEY (TenantId),
      CONSTRAINT FK_SalonPackConfig_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId)
    );
  END;

  COMMIT TRAN;
  SELECT N'DRVO-003 platform core schema ready' AS Result;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

/*
 DRVO ERP RBAC + module entitlement migration candidate — REVIEW ONLY.
 DO NOT EXECUTE. No verified backup/restore drill exists for last132_agent.
 Requires explicit approval AND verified backup before running any DDL.
 This file is NOT wired to CI, startup, or automatic deployment.
 Observed staging schema 2026-10-16: TenantId/MembershipId uniqueidentifier NOT NULL,
 Tenant(TenantId) PK, TenantMembership(MembershipId) PK, no duplicate pairs.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() <> N'last132_agent'
  THROW 51020, 'DRVO_MIGRATION_REQUIRES_ISOLATED_STAGING', 1;
IF SUSER_SNAME() <> N'drvo_agent'
  THROW 51021, 'DRVO_MIGRATION_UNEXPECTED_LOGIN', 1;
IF HAS_DBACCESS(N'last132') <> 0 OR HAS_DBACCESS(N'last132') IS NULL
  THROW 51022, 'DRVO_MIGRATION_PRODUCTION_ISOLATION_NOT_VERIFIED', 1;

IF OBJECT_ID(N'dbo.Tenant', N'U') IS NULL OR OBJECT_ID(N'dbo.TenantMembership', N'U') IS NULL
  THROW 51023, 'DRVO_MIGRATION_BASE_TABLE_MISSING', 1;
IF COL_LENGTH(N'dbo.Tenant', N'TenantId') <> 16
 OR COL_LENGTH(N'dbo.TenantMembership', N'TenantId') <> 16
 OR COL_LENGTH(N'dbo.TenantMembership', N'MembershipId') <> 16
  THROW 51024, 'DRVO_MIGRATION_BASE_COLUMN_MISMATCH', 1;
IF EXISTS (SELECT 1 FROM dbo.TenantMembership GROUP BY TenantId, MembershipId HAVING COUNT_BIG(*) > 1)
  THROW 51025, 'DRVO_MIGRATION_DUPLICATE_MEMBERSHIP_PAIR', 1;

IF OBJECT_ID(N'dbo.DrvoTenantRole', N'U') IS NOT NULL
 OR OBJECT_ID(N'dbo.DrvoTenantRolePermission', N'U') IS NOT NULL
 OR OBJECT_ID(N'dbo.DrvoTenantRoleAssignment', N'U') IS NOT NULL
 OR OBJECT_ID(N'dbo.DrvoTenantModuleEntitlement', N'U') IS NOT NULL
  THROW 51026, 'DRVO_MIGRATION_ALREADY_PARTIALLY_APPLIED', 1;
IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.TenantMembership')
 AND name = N'UX_DrvoTenantMembership_TenantMembership')
  THROW 51027, 'DRVO_MIGRATION_INDEX_ALREADY_EXISTS', 1;

BEGIN TRY
  BEGIN TRANSACTION;

  CREATE UNIQUE INDEX UX_DrvoTenantMembership_TenantMembership
    ON dbo.TenantMembership(TenantId, MembershipId);

  CREATE TABLE dbo.DrvoTenantRole (
    TenantId UNIQUEIDENTIFIER NOT NULL,
    RoleId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_DrvoTenantRole_RoleId DEFAULT NEWID(),
    RoleKey NVARCHAR(64) NOT NULL,
    DisplayName NVARCHAR(120) NOT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_DrvoTenantRole_IsActive DEFAULT 1,
    CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_DrvoTenantRole_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_DrvoTenantRole PRIMARY KEY (TenantId, RoleId),
    CONSTRAINT UQ_DrvoTenantRole_Key UNIQUE (TenantId, RoleKey),
    CONSTRAINT FK_DrvoTenantRole_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant(TenantId)
  );

  CREATE TABLE dbo.DrvoTenantRolePermission (
    TenantId UNIQUEIDENTIFIER NOT NULL,
    RoleId UNIQUEIDENTIFIER NOT NULL,
    PermissionKey NVARCHAR(100) NOT NULL,
    CONSTRAINT PK_DrvoTenantRolePermission PRIMARY KEY (TenantId, RoleId, PermissionKey),
    CONSTRAINT FK_DrvoTenantRolePermission_Role FOREIGN KEY (TenantId, RoleId)
      REFERENCES dbo.DrvoTenantRole(TenantId, RoleId) ON DELETE CASCADE
  );

  CREATE TABLE dbo.DrvoTenantRoleAssignment (
    TenantId UNIQUEIDENTIFIER NOT NULL,
    MembershipId UNIQUEIDENTIFIER NOT NULL,
    RoleId UNIQUEIDENTIFIER NOT NULL,
    AssignedAtUtc DATETIME2(3) NOT NULL
      CONSTRAINT DF_DrvoTenantRoleAssignment_AssignedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_DrvoTenantRoleAssignment PRIMARY KEY (TenantId, MembershipId, RoleId),
    CONSTRAINT FK_DrvoTenantRoleAssignment_Membership FOREIGN KEY (TenantId, MembershipId)
      REFERENCES dbo.TenantMembership(TenantId, MembershipId),
    CONSTRAINT FK_DrvoTenantRoleAssignment_Role FOREIGN KEY (TenantId, RoleId)
      REFERENCES dbo.DrvoTenantRole(TenantId, RoleId)
  );

  CREATE TABLE dbo.DrvoTenantModuleEntitlement (
    TenantId UNIQUEIDENTIFIER NOT NULL,
    ModuleKey NVARCHAR(64) NOT NULL,
    Status NVARCHAR(16) NOT NULL,
    ValidUntilUtc DATETIME2(3) NULL,
    UpdatedAtUtc DATETIME2(3) NOT NULL
      CONSTRAINT DF_DrvoTenantModuleEntitlement_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_DrvoTenantModuleEntitlement PRIMARY KEY (TenantId, ModuleKey),
    CONSTRAINT FK_DrvoTenantModuleEntitlement_Tenant FOREIGN KEY (TenantId)
      REFERENCES dbo.Tenant(TenantId),
    CONSTRAINT CK_DrvoTenantModuleEntitlement_Status
      CHECK (Status IN (N'enabled', N'disabled', N'suspended')),
    CONSTRAINT CK_DrvoTenantModuleEntitlement_ModuleKey
      CHECK (ModuleKey IN (N'pos', N'booking', N'hr', N'inventory',
                           N'treasury', N'reports', N'online_booking'))
  );

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

-- No seeds, no permission grants, no product billing writes, no production access.

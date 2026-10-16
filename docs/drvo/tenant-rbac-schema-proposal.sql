/*
  DRVO ERP — tenant RBAC schema proposal (NOT APPLIED).
  Design review only. DO NOT run before verified staging DB backup,
  schema inspection, migration review and explicit approval.
  Targets staging last132_agent ONLY after those gates.
  No implicit role seeding or legacy Casher permission mapping.
  Assumes dbo.Tenant(TenantId) and dbo.TenantMembership(MembershipId, TenantId).
  Validate existing PKs, SQL Server collation and FKs before adapting.
*/

-- All role IDs and assignments are scoped to the same tenant.
-- An FK from (TenantId, MembershipId) prevents cross-tenant role grants.
-- This unique index is a proposed prerequisite, not an assertion about
-- the current schema. Confirm that TenantMembership has no duplicates.
CREATE UNIQUE INDEX UX_DrvoTenantMembership_TenantMembership
  ON dbo.TenantMembership(TenantId, MembershipId);
GO

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
GO

CREATE TABLE dbo.DrvoTenantRolePermission (
  TenantId UNIQUEIDENTIFIER NOT NULL,
  RoleId UNIQUEIDENTIFIER NOT NULL,
  PermissionKey NVARCHAR(100) NOT NULL,
  CONSTRAINT PK_DrvoTenantRolePermission PRIMARY KEY (TenantId, RoleId, PermissionKey),
  CONSTRAINT FK_DrvoTenantRolePermission_Role FOREIGN KEY (TenantId, RoleId)
    REFERENCES dbo.DrvoTenantRole(TenantId, RoleId) ON DELETE CASCADE
);
GO

CREATE TABLE dbo.DrvoTenantRoleAssignment (
  TenantId UNIQUEIDENTIFIER NOT NULL,
  MembershipId UNIQUEIDENTIFIER NOT NULL,
  RoleId UNIQUEIDENTIFIER NOT NULL,
  AssignedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_DrvoTenantRoleAssignment_AssignedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_DrvoTenantRoleAssignment PRIMARY KEY (TenantId, MembershipId, RoleId),
  CONSTRAINT FK_DrvoTenantRoleAssignment_Membership FOREIGN KEY (TenantId, MembershipId)
    REFERENCES dbo.TenantMembership(TenantId, MembershipId),
  CONSTRAINT FK_DrvoTenantRoleAssignment_Role FOREIGN KEY (TenantId, RoleId)
    REFERENCES dbo.DrvoTenantRole(TenantId, RoleId)
);
GO

-- No INSERT/UPDATE/DELETE statements. A separate, reviewed, audited
-- tenant-scoped role management service must own writes.

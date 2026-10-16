/* DRVO staging smoke: READ-ONLY, no mutations, no credentials.
   Run against last132_agent using staging-only SQL login.
   This is a structural preflight, not a substitute for API E2E tests. */
SET NOCOUNT ON;
IF DB_NAME() <> N'last132_agent' THROW 51000, 'WRONG_DATABASE', 1;
IF ORIGINAL_LOGIN() <> N'drvo_agent' THROW 51001, 'WRONG_SQL_PRINCIPAL', 1;
IF OBJECT_ID(N'dbo.DrvoTenantRole', N'U') IS NULL OR
   OBJECT_ID(N'dbo.DrvoTenantRolePermission', N'U') IS NULL OR
   OBJECT_ID(N'dbo.DrvoTenantRoleAssignment', N'U') IS NULL
  THROW 51002, 'RBAC_SCHEMA_MISSING', 1;
IF OBJECT_ID(N'dbo.Tenant', N'U') IS NULL OR
   OBJECT_ID(N'dbo.Location', N'U') IS NULL OR
   OBJECT_ID(N'dbo.TenantMembership', N'U') IS NULL
  THROW 51003, 'TENANT_SCHEMA_MISSING', 1;
DECLARE @tenant uniqueidentifier;
SELECT @tenant = TenantId FROM dbo.Tenant
  WHERE Code = N'DRVO_DEMO_SALON_01' AND Status = N'active';
IF @tenant IS NULL THROW 51004, 'DEMO_TENANT_MISSING', 1;

SELECT N'DATABASE' AS CheckName, DB_NAME() AS Value;
SELECT N'DEMO_TENANT' AS CheckName, Code, Status, TenantId
  FROM dbo.Tenant WHERE TenantId = @tenant;
SELECT N'ROLE_CATALOG' AS CheckName, r.RoleKey, r.IsActive, COUNT(p.PermissionKey) AS PermissionCount
  FROM dbo.DrvoTenantRole r
  LEFT JOIN dbo.DrvoTenantRolePermission p
    ON p.TenantId = r.TenantId AND p.RoleId = r.RoleId
  WHERE r.TenantId = @tenant
  GROUP BY r.RoleKey, r.IsActive ORDER BY r.RoleKey;
SELECT N'LOCATIONS' AS CheckName, l.BranchCode, l.Status, l.LegacyBranchId,
  b.LifecycleStatus, b.IsActive, b.PublicBookingEnabled, b.ExternalNotificationsEnabled
  FROM dbo.Location l JOIN dbo.TblBranch b ON b.BranchID = l.LegacyBranchId
  WHERE l.TenantId = @tenant ORDER BY l.BranchCode;
SELECT N'MEMBERS' AS CheckName, m.MembershipId, u.loginName, u.UserLevel,
  COUNT(DISTINCT a.RoleId) AS DrvoRoleCount
  FROM dbo.TenantMembership m JOIN dbo.TblUser u ON u.UserID = m.LegacyUserId
  LEFT JOIN dbo.DrvoTenantRoleAssignment a ON a.TenantId = m.TenantId
    AND a.MembershipId = m.MembershipId
  WHERE m.TenantId = @tenant
  GROUP BY m.MembershipId, u.loginName, u.UserLevel ORDER BY u.loginName;

IF EXISTS (SELECT 1 FROM dbo.DrvoTenantRoleAssignment a
  LEFT JOIN dbo.TenantMembership m ON m.TenantId = a.TenantId
    AND m.MembershipId = a.MembershipId
  WHERE a.TenantId = @tenant AND m.MembershipId IS NULL)
  THROW 51005, 'ORPHAN_ROLE_ASSIGNMENT', 1;
IF EXISTS (SELECT 1 FROM dbo.DrvoTenantRoleAssignment a
  LEFT JOIN dbo.DrvoTenantRole r ON r.TenantId = a.TenantId AND r.RoleId = a.RoleId
  WHERE a.TenantId = @tenant AND r.RoleId IS NULL)
  THROW 51006, 'ORPHAN_ROLE', 1;
IF EXISTS (SELECT 1 FROM dbo.Location l JOIN dbo.TblBranch b
  ON b.BranchID = l.LegacyBranchId WHERE l.TenantId = @tenant
  AND b.LifecycleStatus = N'SETUP'
  AND (b.IsActive = 1 OR b.PublicBookingEnabled = 1 OR b.ExternalNotificationsEnabled = 1))
  THROW 51007, 'UNSAFE_SETUP_BRANCH', 1;
IF EXISTS (SELECT 1 FROM dbo.Location l GROUP BY l.LegacyBranchId
  HAVING COUNT(DISTINCT l.TenantId) > 1)
  THROW 51008, 'CROSS_TENANT_BRANCH_MAPPING', 1;
PRINT 'DRVO_STAGING_STRUCTURAL_PREFLIGHT_PASS';

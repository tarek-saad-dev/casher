/* DRVO staging only. Existing roles/assignments are not overwritten.
   Execute only after a verified staging backup. */
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() <> N'last132_agent'
  THROW 51000, 'STAGING_DB_ONLY', 1;
BEGIN TRY
  BEGIN TRAN;
  DECLARE @tenantId uniqueidentifier;
  SELECT @tenantId = TenantId FROM dbo.Tenant WITH (UPDLOCK, HOLDLOCK)
    WHERE Code = N'DRVO_DEMO_SALON_01' AND Status = N'active';
  IF @tenantId IS NULL THROW 51001, 'DEMO_TENANT_NOT_FOUND', 1;
  IF (SELECT COUNT(*) FROM dbo.DrvoTenantRole
      WHERE TenantId = @tenantId AND RoleKey = N'owner' AND IsActive = 1) <> 1
    THROW 51002, 'OWNER_ROLE_NOT_READY', 1;

  DECLARE @templates TABLE (RoleKey nvarchar(64) PRIMARY KEY, DisplayName nvarchar(120));
  INSERT @templates VALUES
    (N'admin',N'مدير الشركة'),(N'manager',N'مدير فرع'),
    (N'staff',N'موظف'),(N'viewer',N'مشاهد');
  DECLARE @permissions TABLE (RoleKey nvarchar(64), PermissionKey nvarchar(100),
    PRIMARY KEY(RoleKey,PermissionKey));
  INSERT @permissions VALUES
    (N'admin',N'organization.read'),(N'admin',N'locations.read'),
    (N'admin',N'locations.manage'),(N'admin',N'members.read'),
    (N'admin',N'members.invite'),(N'admin',N'members.manage'),
    (N'admin',N'roles.read'),(N'admin',N'modules.read'),(N'admin',N'audit.read'),
    (N'manager',N'organization.read'),(N'manager',N'locations.read'),
    (N'manager',N'members.read'),(N'manager',N'modules.read'),
    (N'staff',N'organization.read'),(N'staff',N'modules.read'),
    (N'viewer',N'organization.read'),(N'viewer',N'modules.read');

  IF EXISTS (
    SELECT 1 FROM dbo.DrvoTenantRole r
    JOIN @templates t ON t.RoleKey = r.RoleKey
    WHERE r.TenantId = @tenantId AND
      (r.IsActive <> 1 OR r.DisplayName <> t.DisplayName))
    THROW 51003, 'EXISTING_ROLE_CONFLICT', 1;
  IF EXISTS (
    SELECT 1 FROM dbo.DrvoTenantRolePermission p
    JOIN dbo.DrvoTenantRole r ON r.TenantId = p.TenantId AND r.RoleId = p.RoleId
    JOIN @templates t ON t.RoleKey = r.RoleKey
    WHERE r.TenantId = @tenantId AND NOT EXISTS (
      SELECT 1 FROM @permissions expected
      WHERE expected.RoleKey = r.RoleKey AND expected.PermissionKey = p.PermissionKey))
    THROW 51004, 'EXISTING_ROLE_PERMISSIONS_CONFLICT', 1;

  INSERT dbo.DrvoTenantRole (TenantId, RoleId, RoleKey, DisplayName, IsActive)
  SELECT @tenantId, NEWID(), t.RoleKey, t.DisplayName, 1
  FROM @templates t
  WHERE NOT EXISTS (
    SELECT 1 FROM dbo.DrvoTenantRole r WITH (UPDLOCK, HOLDLOCK)
    WHERE r.TenantId = @tenantId AND r.RoleKey = t.RoleKey);

  INSERT dbo.DrvoTenantRolePermission (TenantId, RoleId, PermissionKey)
  SELECT @tenantId, r.RoleId, p.PermissionKey
  FROM @permissions p
  JOIN dbo.DrvoTenantRole r ON r.TenantId = @tenantId AND r.RoleKey = p.RoleKey
  WHERE NOT EXISTS (
    SELECT 1 FROM dbo.DrvoTenantRolePermission existing WITH (UPDLOCK, HOLDLOCK)
    WHERE existing.TenantId = @tenantId AND existing.RoleId = r.RoleId
      AND existing.PermissionKey = p.PermissionKey);

  IF (SELECT COUNT(*) FROM dbo.DrvoTenantRole
      WHERE TenantId = @tenantId AND IsActive = 1) <> 5
    THROW 51005, 'ROLE_CATALOG_INCOMPLETE', 1;
  COMMIT;
  SELECT r.RoleKey, r.DisplayName, COUNT(p.PermissionKey) AS Permissions
  FROM dbo.DrvoTenantRole r
  LEFT JOIN dbo.DrvoTenantRolePermission p ON p.TenantId = r.TenantId AND p.RoleId = r.RoleId
  WHERE r.TenantId = @tenantId
  GROUP BY r.RoleKey, r.DisplayName ORDER BY r.RoleKey;
  PRINT 'DEMO_ROLE_CATALOG_BACKFILL_PASS';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK;
  THROW;
END CATCH;

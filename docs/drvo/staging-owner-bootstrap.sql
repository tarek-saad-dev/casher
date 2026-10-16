/*
 DRVO ERP — isolated staging bootstrap of the first owner.
 Execute manually ONLY on last132_agent with drvo_agent after schema migration.
 Intended identity: CASHER_BOOT / legacy user 13 / membership below.
 No legacy-role inference, no blanket entitlements, no production writes.
 Idempotent: existing owner role/permissions/assignment are preserved;
 conflicts in owner role identity or unexpected membership fail closed.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() <> N'last132_agent' OR SUSER_SNAME() <> N'drvo_agent'
  THROW 51100, 'DRVO_OWNER_SEED_STAGING_IDENTITY_REQUIRED', 1;
IF ISNULL(HAS_DBACCESS(N'last132'), -1) <> 0
  THROW 51101, 'DRVO_OWNER_SEED_PRODUCTION_ISOLATION_FAILED', 1;

DECLARE @tenantId UNIQUEIDENTIFIER;
DECLARE @membershipId UNIQUEIDENTIFIER = '173D433E-F36B-1410-8820-009EC495C7E1';
DECLARE @roleId UNIQUEIDENTIFIER;
DECLARE @permissions TABLE (PermissionKey NVARCHAR(100) NOT NULL PRIMARY KEY);
INSERT INTO @permissions (PermissionKey) VALUES
 (N'organization.read'),(N'organization.manage'),
 (N'locations.read'),(N'locations.manage'),
 (N'members.read'),(N'members.invite'),(N'members.manage'),
 (N'roles.read'),(N'roles.manage'),
 (N'modules.read'),(N'modules.manage'),
 (N'billing.read'),(N'billing.manage'),(N'audit.read');

BEGIN TRY
  BEGIN TRANSACTION;

  SELECT @tenantId = t.TenantId
  FROM dbo.Tenant AS t WITH (UPDLOCK, HOLDLOCK)
  WHERE t.Code = N'CASHER_BOOT' AND t.Status = N'active';

  IF @tenantId IS NULL OR
    (SELECT COUNT_BIG(*) FROM dbo.Tenant WHERE Code = N'CASHER_BOOT' AND Status = N'active') <> 1
    THROW 51102, 'DRVO_OWNER_SEED_TENANT_NOT_UNIQUE_OR_INACTIVE', 1;

  IF (SELECT COUNT_BIG(*) FROM dbo.TenantMembership WITH (UPDLOCK, HOLDLOCK)
      WHERE TenantId = @tenantId AND MembershipId = @membershipId AND LegacyUserId = 13) <> 1
    THROW 51103, 'DRVO_OWNER_SEED_MEMBERSHIP_MISMATCH', 1;

  IF NOT EXISTS (SELECT 1 FROM dbo.TblUser WHERE UserID = 13 AND isDeleted = 0)
    THROW 51104, 'DRVO_OWNER_SEED_USER_INACTIVE', 1;

  SELECT @roleId = RoleId FROM dbo.DrvoTenantRole WITH (UPDLOCK, HOLDLOCK)
  WHERE TenantId = @tenantId AND RoleKey = N'owner';

  IF @roleId IS NULL
  BEGIN
    SET @roleId = NEWID();
    INSERT INTO dbo.DrvoTenantRole (TenantId, RoleId, RoleKey, DisplayName, IsActive)
    VALUES (@tenantId, @roleId, N'owner', N'مالك الشركة', 1);
  END
  ELSE IF EXISTS (SELECT 1 FROM dbo.DrvoTenantRole
                  WHERE TenantId = @tenantId AND RoleId = @roleId AND IsActive <> 1)
    THROW 51105, 'DRVO_OWNER_SEED_EXISTING_OWNER_ROLE_INACTIVE', 1;

  INSERT INTO dbo.DrvoTenantRolePermission (TenantId, RoleId, PermissionKey)
  SELECT @tenantId, @roleId, p.PermissionKey
  FROM @permissions p
  WHERE NOT EXISTS (
    SELECT 1 FROM dbo.DrvoTenantRolePermission rp
    WHERE rp.TenantId = @tenantId AND rp.RoleId = @roleId
      AND rp.PermissionKey = p.PermissionKey
  );

  IF NOT EXISTS (
    SELECT 1 FROM dbo.DrvoTenantRoleAssignment
    WHERE TenantId = @tenantId AND MembershipId = @membershipId AND RoleId = @roleId
  )
    INSERT INTO dbo.DrvoTenantRoleAssignment (TenantId, MembershipId, RoleId)
    VALUES (@tenantId, @membershipId, @roleId);

  IF (SELECT COUNT_BIG(*) FROM dbo.DrvoTenantRolePermission
      WHERE TenantId = @tenantId AND RoleId = @roleId
        AND PermissionKey IN (SELECT PermissionKey FROM @permissions)) <> 14
    THROW 51106, 'DRVO_OWNER_SEED_PERMISSION_COUNT_MISMATCH', 1;

  COMMIT TRANSACTION;

  SELECT t.Code AS TenantCode, m.LegacyUserId, r.RoleKey,
    (SELECT COUNT_BIG(*) FROM dbo.DrvoTenantRolePermission p
     WHERE p.TenantId = r.TenantId AND p.RoleId = r.RoleId) AS PermissionCount
  FROM dbo.DrvoTenantRoleAssignment a
  JOIN dbo.TenantMembership m ON m.TenantId = a.TenantId AND m.MembershipId = a.MembershipId
  JOIN dbo.Tenant t ON t.TenantId = a.TenantId
  JOIN dbo.DrvoTenantRole r ON r.TenantId = a.TenantId AND r.RoleId = a.RoleId
  WHERE a.TenantId = @tenantId AND a.MembershipId = @membershipId AND r.RoleId = @roleId;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

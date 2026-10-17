-- Staging-only demo bootstrap. Run explicitly as drvo_agent against last132_agent.
-- Adds pos.read to the existing owner role of ONE known demo tenant.
-- Does not grant pos.sell, does not change other tenants or platform permissions.
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() <> N'last132_agent'
  THROW 51000, 'STAGING_DATABASE_ONLY', 1;

DECLARE @tenant UNIQUEIDENTIFIER = 'B1CB423E-F36B-1410-8822-009EC495C7E1';
DECLARE @ownerUser INT = 75;
DECLARE @role UNIQUEIDENTIFIER;
DECLARE @matches INT;

BEGIN TRANSACTION;
SELECT @matches = COUNT(*)
FROM dbo.Tenant AS t WITH (UPDLOCK, HOLDLOCK)
JOIN dbo.TenantMembership AS m ON m.TenantId = t.TenantId
JOIN dbo.DrvoTenantRoleAssignment AS a ON a.TenantId = m.TenantId AND a.MembershipId = m.MembershipId
JOIN dbo.DrvoTenantRole AS r ON r.TenantId = a.TenantId AND r.RoleId = a.RoleId
WHERE t.TenantId = @tenant AND t.Code = N'DRVO_DEMO_SALON_01'
  AND t.Status = N'active' AND m.LegacyUserId = @ownerUser
  AND r.RoleKey = N'owner' AND r.IsActive = 1;

IF @matches <> 1
  THROW 51001, 'DEMO_OWNER_ROLE_NOT_UNIQUE', 1;

SELECT @role = r.RoleId
FROM dbo.TenantMembership AS m
JOIN dbo.DrvoTenantRoleAssignment AS a ON a.TenantId = m.TenantId AND a.MembershipId = m.MembershipId
JOIN dbo.DrvoTenantRole AS r ON r.TenantId = a.TenantId AND r.RoleId = a.RoleId
WHERE m.TenantId = @tenant AND m.LegacyUserId = @ownerUser AND r.RoleKey = N'owner';

IF NOT EXISTS (
  SELECT 1 FROM dbo.DrvoTenantRolePermission WITH (UPDLOCK, HOLDLOCK)
  WHERE TenantId = @tenant AND RoleId = @role AND PermissionKey = N'pos.read'
)
  INSERT INTO dbo.DrvoTenantRolePermission (TenantId, RoleId, PermissionKey)
  VALUES (@tenant, @role, N'pos.read');

IF EXISTS (
  SELECT 1 FROM dbo.DrvoTenantRolePermission
  WHERE TenantId = @tenant AND RoleId = @role AND PermissionKey = N'pos.sell'
)
  THROW 51002, 'DEMO_OWNER_POS_SELL_MUST_REMAIN_DISABLED', 1;

COMMIT TRANSACTION;
SELECT N'DEMO_POS_READ_GRANTED' AS Result, @tenant AS TenantId, @role AS RoleId;

/* DRVO PLATFORM AUTHORITY — STAGING CANDIDATE ONLY. DO NOT EXECUTE AUTOMATICALLY.
   Review, backup/restore drill and explicit approval required before DDL.
   This table is independent of tenant RBAC and legacy super_admin.
   No initial platform grants are seeded. All users fail closed until reviewed.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() <> N'last132_agent'
  THROW 51101, 'PLATFORM_AUTHORITY_STAGING_ONLY', 1;
IF SUSER_SNAME() <> N'drvo_agent'
  THROW 51102, 'PLATFORM_AUTHORITY_UNEXPECTED_LOGIN', 1;
IF ISNULL(HAS_DBACCESS(N'last132'), 1) <> 0
  THROW 51103, 'PLATFORM_AUTHORITY_PRODUCTION_ISOLATION_NOT_VERIFIED', 1;
IF OBJECT_ID(N'dbo.DrvoPlatformOperatorGrant', N'U') IS NOT NULL
  THROW 51104, 'PLATFORM_AUTHORITY_ALREADY_PRESENT', 1;

BEGIN TRY
  BEGIN TRANSACTION;
  CREATE TABLE dbo.DrvoPlatformOperatorGrant (
    LegacyUserId INT NOT NULL,
    PermissionKey NVARCHAR(80) NOT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_DrvoPlatformOperatorGrant_Active DEFAULT (0),
    GrantedAtUtc DATETIME2(3) NOT NULL
      CONSTRAINT DF_DrvoPlatformOperatorGrant_GrantedAt DEFAULT SYSUTCDATETIME(),
    GrantedByUserId INT NULL,
    CONSTRAINT PK_DrvoPlatformOperatorGrant PRIMARY KEY (LegacyUserId, PermissionKey),
    CONSTRAINT CK_DrvoPlatformOperatorGrant_Permission
      CHECK (PermissionKey IN (N'platform.entitlements.read', N'platform.entitlements.manage'))
  );
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
-- No grants, no tenant entitlements, no subscription changes.

/* DRVO staging platform operator bootstrap. NEVER execute on production.
   Explicit operator approval required. Grants only the known legacy user 13
   after verifying it exists and is active. Idempotent; no tenant entitlements.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() <> N'last132_agent' THROW 51201, 'STAGING_ONLY', 1;
IF SUSER_SNAME() <> N'drvo_agent' THROW 51202, 'UNEXPECTED_LOGIN', 1;
IF ISNULL(HAS_DBACCESS(N'last132'), 1) <> 0 THROW 51203, 'PRODUCTION_ISOLATION_FAILED', 1;
IF OBJECT_ID(N'dbo.DrvoPlatformOperatorGrant', N'U') IS NULL
  THROW 51204, 'PLATFORM_GRANT_SCHEMA_MISSING', 1;
-- Require the operator to confirm UserID 13 in the existing staging users table
-- before applying this bootstrap. The identity check is done via the preview
-- query in the runbook; never infer identity solely from a client session.
BEGIN TRY
  BEGIN TRANSACTION;
  DECLARE @GrantedByUserId INT = 13;
  MERGE dbo.DrvoPlatformOperatorGrant WITH (HOLDLOCK) AS target
  USING (VALUES
    (13, N'platform.entitlements.read'),
    (13, N'platform.entitlements.manage')
  ) AS source(LegacyUserId, PermissionKey)
  ON target.LegacyUserId = source.LegacyUserId
     AND target.PermissionKey = source.PermissionKey
  WHEN MATCHED THEN UPDATE SET IsActive = 1
  WHEN NOT MATCHED THEN INSERT (LegacyUserId, PermissionKey, IsActive, GrantedByUserId)
    VALUES (source.LegacyUserId, source.PermissionKey, 1, @GrantedByUserId);
  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
SELECT LegacyUserId, PermissionKey, IsActive
FROM dbo.DrvoPlatformOperatorGrant
WHERE LegacyUserId = 13
ORDER BY PermissionKey;

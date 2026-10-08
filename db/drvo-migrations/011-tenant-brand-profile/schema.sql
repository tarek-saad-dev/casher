/*
  DRVO-017 Tenant brand profile (migration 11).

  Additive only: one new table, insert-only backfill, insert-only page grant.
  - Every tenant gets a brand row derived from Tenant.Name / Tenant.DefaultTimezone.
  - CASHER_BOOT gets its existing printed identity (Cut Salon) so receipts, tickets and
    the navigation shell render exactly what they rendered before, now from data.
  - Rows are never overwritten: later edits made through the tenant settings or the
    operator console survive a re-run.
  - PublicBookingOrigins is stored data only; wiring it into public booking CORS is
    out of scope (public booking page is not part of DRVO-017).
  Migration id 10 is reserved for DRVO-015 (master-data tenancy).
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF OBJECT_ID(N'dbo.TenantBrandProfile', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.TenantBrandProfile (
      TenantId UNIQUEIDENTIFIER NOT NULL,
      DisplayName NVARCHAR(128) NOT NULL,
      LogoUrl NVARCHAR(512) NULL,
      Phone NVARCHAR(40) NULL,
      Address NVARCHAR(256) NULL,
      PrimaryColor NVARCHAR(7) NULL,
      AccentColor NVARCHAR(7) NULL,
      ReceiptFooter NVARCHAR(256) NULL,
      Timezone NVARCHAR(64) NOT NULL,
      PublicBookingOrigins NVARCHAR(2000) NULL,
      Revision INT NOT NULL CONSTRAINT DF_TenantBrandProfile_Revision DEFAULT 1,
      CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_TenantBrandProfile_CreatedAt DEFAULT SYSUTCDATETIME(),
      UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_TenantBrandProfile_UpdatedAt DEFAULT SYSUTCDATETIME(),
      UpdatedByUserId INT NULL,
      CONSTRAINT PK_TenantBrandProfile PRIMARY KEY (TenantId),
      CONSTRAINT FK_TenantBrandProfile_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId),
      CONSTRAINT CK_TenantBrandProfile_DisplayName CHECK (LEN(LTRIM(RTRIM(DisplayName))) > 0),
      CONSTRAINT CK_TenantBrandProfile_Timezone CHECK (LEN(LTRIM(RTRIM(Timezone))) > 0),
      CONSTRAINT CK_TenantBrandProfile_LogoUrl CHECK (
        LogoUrl IS NULL OR LogoUrl LIKE N'/%' OR LogoUrl LIKE N'https://%'
      ),
      CONSTRAINT CK_TenantBrandProfile_PrimaryColor CHECK (
        PrimaryColor IS NULL OR PrimaryColor LIKE N'#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'
      ),
      CONSTRAINT CK_TenantBrandProfile_AccentColor CHECK (
        AccentColor IS NULL OR AccentColor LIKE N'#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'
      ),
      CONSTRAINT CK_TenantBrandProfile_Origins CHECK (
        PublicBookingOrigins IS NULL OR ISJSON(PublicBookingOrigins) = 1
      ),
      CONSTRAINT CK_TenantBrandProfile_Revision CHECK (Revision >= 1)
    );
  END;

  /* Preserve the CUT printed identity for the bootstrap tenant. Insert-only.
     Address carries the line receipts print under the name ("صالون كت للرجال"). */
  INSERT INTO dbo.TenantBrandProfile (
    TenantId, DisplayName, LogoUrl, Phone, Address, PrimaryColor, AccentColor, ReceiptFooter, Timezone
  )
  SELECT
    t.TenantId,
    N'Cut Salon',
    N'/cutsalon.png',
    N'01012126899 - 035861483',
    N'صالون كت للرجال',
    N'#D6A84F',
    N'#14B8A6',
    N'شكراً لاختياركم Cut Salon',
    t.DefaultTimezone
  FROM dbo.Tenant t
  WHERE t.Code = N'CASHER_BOOT'
    AND NOT EXISTS (SELECT 1 FROM dbo.TenantBrandProfile b WHERE b.TenantId = t.TenantId);

  /* Every other existing tenant: neutral brand from its own data. Insert-only. */
  INSERT INTO dbo.TenantBrandProfile (TenantId, DisplayName, Timezone)
  SELECT
    t.TenantId,
    LEFT(COALESCE(NULLIF(LTRIM(RTRIM(t.Name)), N''), t.Code), 128),
    LEFT(COALESCE(NULLIF(LTRIM(RTRIM(t.DefaultTimezone)), N''), N'UTC'), 64)
  FROM dbo.Tenant t
  WHERE NOT EXISTS (SELECT 1 FROM dbo.TenantBrandProfile b WHERE b.TenantId = t.TenantId);

  /* Tenant settings page: visible to tenant admins. Insert-only grant. */
  IF OBJECT_ID(N'dbo.TblSystemPages', N'U') IS NOT NULL
     AND OBJECT_ID(N'dbo.TblPageRoleAccess', N'U') IS NOT NULL
     AND OBJECT_ID(N'dbo.TblRoles', N'U') IS NOT NULL
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.TblSystemPages WHERE PageKey = N'admin.tenant')
      INSERT INTO dbo.TblSystemPages (PageKey, PageName, PagePath, Section, AccessMode, SortOrder)
      VALUES (N'admin.tenant', N'هوية المنشأة', N'/admin/tenant', N'الإدارة', N'roles', 109);

    INSERT INTO dbo.TblPageRoleAccess (PageID, RoleID, CanView, CanEdit, CanDelete)
    SELECT p.PageID, r.RoleID, 1, 1, 0
    FROM dbo.TblSystemPages p
    CROSS JOIN dbo.TblRoles r
    WHERE p.PageKey = N'admin.tenant'
      AND r.RoleKey IN (N'admin', N'super_admin')
      AND NOT EXISTS (
        SELECT 1 FROM dbo.TblPageRoleAccess x WHERE x.PageID = p.PageID AND x.RoleID = r.RoleID
      );
  END;

  COMMIT TRAN;
  SELECT N'DRVO-017 tenant brand profile ready' AS Result;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

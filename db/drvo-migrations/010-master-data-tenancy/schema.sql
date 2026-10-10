/*
  DRVO-015 Shared master-data tenancy.

  Adds an authoritative TenantId to the legacy master-data tables that were shared by every
  tenant: TblClient, TblPro, TblCat, TblServicePackage, TblServicePackageItem,
  TblPaymentMethods, TblExpINCat and TblEmp (column + backfill only; HR behavior is not owned
  here).

  Additive only: new nullable column -> backfill -> verify no NULLs -> NOT NULL, then
  foreign keys to dbo.Tenant and tenant-scoped indexes. No row is deleted and no existing
  business column changes value.

  Backfill rules (rows whose TenantId is already set are never reassigned):
    - Exactly one CASHER_BOOT tenant must exist, otherwise the migration aborts.
    - TblClient, TblPro, TblCat, TblServicePackage, TblPaymentMethods, TblExpINCat:
      all pre-existing rows are CUT data and belong to CASHER_BOOT.
    - TblServicePackageItem inherits the TenantId of its parent package.
    - TblEmp takes the tenant of the Locations its branch assignments map to; an employee
      with no mapped assignment belongs to CASHER_BOOT; an employee assigned to branches of
      more than one tenant aborts the migration (ambiguous, never guessed).

  Statements that reference TenantId run through sp_executesql so the batch compiles before
  the column exists.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  IF (SELECT COUNT(*) FROM dbo.Tenant WHERE Code = N'CASHER_BOOT') <> 1
    THROW 51015, N'DRVO-015: exactly one CASHER_BOOT tenant is required before the master-data backfill.', 1;

  DECLARE @boot UNIQUEIDENTIFIER = (SELECT TenantId FROM dbo.Tenant WHERE Code = N'CASHER_BOOT');

  /* Package tables are owned by this migration from now on (previously created lazily at runtime). */
  IF OBJECT_ID(N'dbo.TblServicePackage', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.TblServicePackage (
      PackageID          INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      NameEn             NVARCHAR(200) NOT NULL,
      NameAr             NVARCHAR(200) NULL,
      PackageKind        NVARCHAR(20)  NOT NULL,
      PackagePrice       DECIMAL(10,2) NOT NULL,
      OriginalPrice      DECIMAL(10,2) NULL,
      DurationMinutes    INT NULL,
      Bonus              DECIMAL(10,2) NOT NULL CONSTRAINT DF_TblServicePackage_Bonus DEFAULT (0),
      ImageUrl           NVARCHAR(1000) NULL,
      DescriptionAr      NVARCHAR(500) NULL,
      DescriptionEn      NVARCHAR(500) NULL,
      SortOrder          INT NOT NULL CONSTRAINT DF_TblServicePackage_SortOrder DEFAULT (0),
      IsPopular          BIT NOT NULL CONSTRAINT DF_TblServicePackage_IsPopular DEFAULT (0),
      isDeleted          BIT NOT NULL CONSTRAINT DF_TblServicePackage_isDeleted DEFAULT (0),
      DepositAmount      DECIMAL(10,2) NULL,
      IncludesTrial      BIT NOT NULL CONSTRAINT DF_TblServicePackage_IncludesTrial DEFAULT (0),
      SessionCount       INT NULL,
      NotesAr            NVARCHAR(500) NULL,
      CreatedAt          DATETIME2 NOT NULL CONSTRAINT DF_TblServicePackage_CreatedAt DEFAULT (SYSDATETIME()),
      UpdatedAt          DATETIME2 NULL,
      CONSTRAINT CK_TblServicePackage_Kind CHECK (PackageKind IN (N'regular', N'groom'))
    );
  END;

  IF OBJECT_ID(N'dbo.TblServicePackageItem', N'U') IS NULL
  BEGIN
    CREATE TABLE dbo.TblServicePackageItem (
      PackageItemID      INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      PackageID          INT NOT NULL,
      ProID              INT NOT NULL,
      Qty                DECIMAL(10,2) NOT NULL CONSTRAINT DF_TblServicePackageItem_Qty DEFAULT (1),
      SortOrder          INT NOT NULL CONSTRAINT DF_TblServicePackageItem_SortOrder DEFAULT (0),
      IsOptional         BIT NOT NULL CONSTRAINT DF_TblServicePackageItem_IsOptional DEFAULT (0),
      CONSTRAINT FK_TblServicePackageItem_Package
        FOREIGN KEY (PackageID) REFERENCES dbo.TblServicePackage (PackageID),
      CONSTRAINT UQ_TblServicePackageItem_Pkg_Pro UNIQUE (PackageID, ProID)
    );
  END;

  IF COL_LENGTH(N'dbo.TblClient', N'TenantId') IS NULL
    ALTER TABLE dbo.TblClient ADD TenantId UNIQUEIDENTIFIER NULL;
  IF COL_LENGTH(N'dbo.TblPro', N'TenantId') IS NULL
    ALTER TABLE dbo.TblPro ADD TenantId UNIQUEIDENTIFIER NULL;
  IF COL_LENGTH(N'dbo.TblCat', N'TenantId') IS NULL
    ALTER TABLE dbo.TblCat ADD TenantId UNIQUEIDENTIFIER NULL;
  IF COL_LENGTH(N'dbo.TblServicePackage', N'TenantId') IS NULL
    ALTER TABLE dbo.TblServicePackage ADD TenantId UNIQUEIDENTIFIER NULL;
  IF COL_LENGTH(N'dbo.TblServicePackageItem', N'TenantId') IS NULL
    ALTER TABLE dbo.TblServicePackageItem ADD TenantId UNIQUEIDENTIFIER NULL;
  IF COL_LENGTH(N'dbo.TblPaymentMethods', N'TenantId') IS NULL
    ALTER TABLE dbo.TblPaymentMethods ADD TenantId UNIQUEIDENTIFIER NULL;
  IF COL_LENGTH(N'dbo.TblExpINCat', N'TenantId') IS NULL
    ALTER TABLE dbo.TblExpINCat ADD TenantId UNIQUEIDENTIFIER NULL;
  IF COL_LENGTH(N'dbo.TblEmp', N'TenantId') IS NULL
    ALTER TABLE dbo.TblEmp ADD TenantId UNIQUEIDENTIFIER NULL;

  /* CUT master data -> CASHER_BOOT. */
  EXEC sp_executesql N'
    UPDATE dbo.TblClient          SET TenantId = @boot WHERE TenantId IS NULL;
    UPDATE dbo.TblPro             SET TenantId = @boot WHERE TenantId IS NULL;
    UPDATE dbo.TblCat             SET TenantId = @boot WHERE TenantId IS NULL;
    UPDATE dbo.TblServicePackage  SET TenantId = @boot WHERE TenantId IS NULL;
    UPDATE dbo.TblPaymentMethods  SET TenantId = @boot WHERE TenantId IS NULL;
    UPDATE dbo.TblExpINCat        SET TenantId = @boot WHERE TenantId IS NULL;
  ', N'@boot UNIQUEIDENTIFIER', @boot = @boot;

  EXEC sp_executesql N'
    UPDATE i SET i.TenantId = p.TenantId
    FROM dbo.TblServicePackageItem i
    JOIN dbo.TblServicePackage p ON p.PackageID = i.PackageID
    WHERE i.TenantId IS NULL;
  ';

  /* Employees: tenant of their assigned branches' Locations, else CASHER_BOOT. */
  IF OBJECT_ID(N'dbo.TblEmpBranchAssignment', N'U') IS NOT NULL
  BEGIN
    IF EXISTS (
      SELECT a.EmpID
      FROM dbo.TblEmpBranchAssignment a
      JOIN dbo.Location l ON l.LegacyBranchId = a.BranchID
      GROUP BY a.EmpID
      HAVING COUNT(DISTINCT l.TenantId) > 1
    )
      THROW 51016, N'DRVO-015: an employee is assigned to branches of more than one tenant; resolve before backfill.', 1;

    EXEC sp_executesql N'
      UPDATE e SET e.TenantId = m.TenantId
      FROM dbo.TblEmp e
      JOIN (
        SELECT a.EmpID, MIN(CONVERT(NVARCHAR(36), l.TenantId)) AS TenantId
        FROM dbo.TblEmpBranchAssignment a
        JOIN dbo.Location l ON l.LegacyBranchId = a.BranchID
        GROUP BY a.EmpID
      ) m ON m.EmpID = e.EmpID
      WHERE e.TenantId IS NULL;
    ';
  END;

  EXEC sp_executesql N'
    UPDATE dbo.TblEmp SET TenantId = @boot WHERE TenantId IS NULL;
  ', N'@boot UNIQUEIDENTIFIER', @boot = @boot;

  /* Valid backfill gate: no NULL TenantId may remain before NOT NULL is enforced. */
  DECLARE @nulls INT;
  EXEC sp_executesql N'
    SELECT @n =
        (SELECT COUNT(*) FROM dbo.TblClient WHERE TenantId IS NULL)
      + (SELECT COUNT(*) FROM dbo.TblPro WHERE TenantId IS NULL)
      + (SELECT COUNT(*) FROM dbo.TblCat WHERE TenantId IS NULL)
      + (SELECT COUNT(*) FROM dbo.TblServicePackage WHERE TenantId IS NULL)
      + (SELECT COUNT(*) FROM dbo.TblServicePackageItem WHERE TenantId IS NULL)
      + (SELECT COUNT(*) FROM dbo.TblPaymentMethods WHERE TenantId IS NULL)
      + (SELECT COUNT(*) FROM dbo.TblExpINCat WHERE TenantId IS NULL)
      + (SELECT COUNT(*) FROM dbo.TblEmp WHERE TenantId IS NULL);
  ', N'@n INT OUTPUT', @n = @nulls OUTPUT;
  IF @nulls <> 0
    THROW 51017, N'DRVO-015: NULL TenantId remains after backfill; NOT NULL not enforced.', 1;

  IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.TblClient') AND name = N'TenantId' AND is_nullable = 1)
    EXEC sp_executesql N'ALTER TABLE dbo.TblClient ALTER COLUMN TenantId UNIQUEIDENTIFIER NOT NULL;';
  IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.TblPro') AND name = N'TenantId' AND is_nullable = 1)
    EXEC sp_executesql N'ALTER TABLE dbo.TblPro ALTER COLUMN TenantId UNIQUEIDENTIFIER NOT NULL;';
  IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.TblCat') AND name = N'TenantId' AND is_nullable = 1)
    EXEC sp_executesql N'ALTER TABLE dbo.TblCat ALTER COLUMN TenantId UNIQUEIDENTIFIER NOT NULL;';
  IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.TblServicePackage') AND name = N'TenantId' AND is_nullable = 1)
    EXEC sp_executesql N'ALTER TABLE dbo.TblServicePackage ALTER COLUMN TenantId UNIQUEIDENTIFIER NOT NULL;';
  IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.TblServicePackageItem') AND name = N'TenantId' AND is_nullable = 1)
    EXEC sp_executesql N'ALTER TABLE dbo.TblServicePackageItem ALTER COLUMN TenantId UNIQUEIDENTIFIER NOT NULL;';
  IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.TblPaymentMethods') AND name = N'TenantId' AND is_nullable = 1)
    EXEC sp_executesql N'ALTER TABLE dbo.TblPaymentMethods ALTER COLUMN TenantId UNIQUEIDENTIFIER NOT NULL;';
  IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.TblExpINCat') AND name = N'TenantId' AND is_nullable = 1)
    EXEC sp_executesql N'ALTER TABLE dbo.TblExpINCat ALTER COLUMN TenantId UNIQUEIDENTIFIER NOT NULL;';
  IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.TblEmp') AND name = N'TenantId' AND is_nullable = 1)
    EXEC sp_executesql N'ALTER TABLE dbo.TblEmp ALTER COLUMN TenantId UNIQUEIDENTIFIER NOT NULL;';

  /* Tenant foreign keys. */
  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblClient_Tenant')
    EXEC sp_executesql N'ALTER TABLE dbo.TblClient WITH CHECK ADD CONSTRAINT FK_TblClient_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId);';
  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblPro_Tenant')
    EXEC sp_executesql N'ALTER TABLE dbo.TblPro WITH CHECK ADD CONSTRAINT FK_TblPro_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId);';
  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblCat_Tenant')
    EXEC sp_executesql N'ALTER TABLE dbo.TblCat WITH CHECK ADD CONSTRAINT FK_TblCat_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId);';
  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblServicePackage_Tenant')
    EXEC sp_executesql N'ALTER TABLE dbo.TblServicePackage WITH CHECK ADD CONSTRAINT FK_TblServicePackage_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId);';
  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblServicePackageItem_Tenant')
    EXEC sp_executesql N'ALTER TABLE dbo.TblServicePackageItem WITH CHECK ADD CONSTRAINT FK_TblServicePackageItem_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId);';
  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblPaymentMethods_Tenant')
    EXEC sp_executesql N'ALTER TABLE dbo.TblPaymentMethods WITH CHECK ADD CONSTRAINT FK_TblPaymentMethods_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId);';
  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblExpINCat_Tenant')
    EXEC sp_executesql N'ALTER TABLE dbo.TblExpINCat WITH CHECK ADD CONSTRAINT FK_TblExpINCat_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId);';
  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblEmp_Tenant')
    EXEC sp_executesql N'ALTER TABLE dbo.TblEmp WITH CHECK ADD CONSTRAINT FK_TblEmp_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId);';

  /* Tenant-scoped uniques: (TenantId, surrogate id) is the target of tenant-consistent references. */
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.TblClient') AND name = N'UX_TblClient_Tenant_ClientID')
    EXEC sp_executesql N'CREATE UNIQUE INDEX UX_TblClient_Tenant_ClientID ON dbo.TblClient (TenantId, ClientID);';
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.TblPro') AND name = N'UX_TblPro_Tenant_ProID')
    EXEC sp_executesql N'CREATE UNIQUE INDEX UX_TblPro_Tenant_ProID ON dbo.TblPro (TenantId, ProID);';
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.TblCat') AND name = N'UX_TblCat_Tenant_CatID')
    EXEC sp_executesql N'CREATE UNIQUE INDEX UX_TblCat_Tenant_CatID ON dbo.TblCat (TenantId, CatID);';
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.TblServicePackage') AND name = N'UX_TblServicePackage_Tenant_PackageID')
    EXEC sp_executesql N'CREATE UNIQUE INDEX UX_TblServicePackage_Tenant_PackageID ON dbo.TblServicePackage (TenantId, PackageID);';
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.TblServicePackageItem') AND name = N'UX_TblServicePackageItem_Tenant_PackageItemID')
    EXEC sp_executesql N'CREATE UNIQUE INDEX UX_TblServicePackageItem_Tenant_PackageItemID ON dbo.TblServicePackageItem (TenantId, PackageItemID);';
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.TblPaymentMethods') AND name = N'UX_TblPaymentMethods_Tenant_PaymentID')
    EXEC sp_executesql N'CREATE UNIQUE INDEX UX_TblPaymentMethods_Tenant_PaymentID ON dbo.TblPaymentMethods (TenantId, PaymentID);';
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.TblExpINCat') AND name = N'UX_TblExpINCat_Tenant_ExpINID')
    EXEC sp_executesql N'CREATE UNIQUE INDEX UX_TblExpINCat_Tenant_ExpINID ON dbo.TblExpINCat (TenantId, ExpINID);';
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.TblEmp') AND name = N'UX_TblEmp_Tenant_EmpID')
    EXEC sp_executesql N'CREATE UNIQUE INDEX UX_TblEmp_Tenant_EmpID ON dbo.TblEmp (TenantId, EmpID);';

  /* A package item can only live in the tenant of its package. */
  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_TblServicePackageItem_Package_Tenant')
    EXEC sp_executesql N'
      ALTER TABLE dbo.TblServicePackageItem WITH CHECK
        ADD CONSTRAINT FK_TblServicePackageItem_Package_Tenant
        FOREIGN KEY (TenantId, PackageID) REFERENCES dbo.TblServicePackage (TenantId, PackageID);
    ';

  /* Tenant-scoped lookup indexes. */
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.TblPro') AND name = N'IX_TblPro_Tenant_CatID')
    EXEC sp_executesql N'CREATE INDEX IX_TblPro_Tenant_CatID ON dbo.TblPro (TenantId, CatID);';
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.TblServicePackage') AND name = N'IX_TblServicePackage_Tenant_Kind_Active')
    EXEC sp_executesql N'CREATE INDEX IX_TblServicePackage_Tenant_Kind_Active ON dbo.TblServicePackage (TenantId, PackageKind, isDeleted, SortOrder);';
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.TblExpINCat') AND name = N'IX_TblExpINCat_Tenant_Type')
    EXEC sp_executesql N'CREATE INDEX IX_TblExpINCat_Tenant_Type ON dbo.TblExpINCat (TenantId, ExpINType);';
  /* Mobile is a legacy column of unknown width; index it only when it is a valid index key. */
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.TblClient') AND name = N'IX_TblClient_Tenant_Mobile')
     AND EXISTS (
       SELECT 1 FROM sys.columns c
       JOIN sys.types t ON t.user_type_id = c.user_type_id
       WHERE c.object_id = OBJECT_ID(N'dbo.TblClient') AND c.name = N'Mobile'
         AND t.name IN (N'nvarchar', N'varchar', N'nchar', N'char') AND c.max_length BETWEEN 1 AND 800
     )
    EXEC sp_executesql N'CREATE INDEX IX_TblClient_Tenant_Mobile ON dbo.TblClient (TenantId, Mobile);';

  COMMIT TRAN;
  SELECT N'DRVO-015 master-data tenancy ready' AS Result;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;

import type { ConnectionPool } from 'mssql';

let tablesReady: boolean | null = null;

async function packagesTablesExist(db: ConnectionPool): Promise<boolean> {
  const result = await db.request().query(`
    SELECT
      CASE WHEN OBJECT_ID(N'dbo.TblServicePackage', N'U') IS NOT NULL THEN 1 ELSE 0 END AS hasPackage,
      CASE WHEN OBJECT_ID(N'dbo.TblServicePackageItem', N'U') IS NOT NULL THEN 1 ELSE 0 END AS hasItem
  `);
  const row = result.recordset[0];
  return Number(row?.hasPackage) === 1 && Number(row?.hasItem) === 1;
}

/** Idempotent — creates package tables if missing. Returns whether they are usable. */
export async function ensureServicePackagesTables(db: ConnectionPool): Promise<boolean> {
  if (tablesReady === true) return true;
  if (tablesReady === false) return false;

  try {
    await db.request().query(`
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

        CREATE NONCLUSTERED INDEX IX_TblServicePackage_Kind_Active
          ON dbo.TblServicePackage (PackageKind, isDeleted, SortOrder);
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

        CREATE NONCLUSTERED INDEX IX_TblServicePackageItem_PackageID
          ON dbo.TblServicePackageItem (PackageID, SortOrder)
          INCLUDE (ProID, Qty, IsOptional);
      END;
    `);
  } catch (err) {
    console.warn('[ensureServicePackagesTables] create failed:', err);
  }

  try {
    tablesReady = await packagesTablesExist(db);
    if (!tablesReady) {
      console.warn('[ensureServicePackagesTables] tables still missing after migration attempt');
    }
    return tablesReady;
  } catch (err) {
    console.warn('[ensureServicePackagesTables] existence check failed:', err);
    tablesReady = false;
    return false;
  }
}

export type PackageKind = 'regular' | 'groom';

export function isPackageKind(value: unknown): value is PackageKind {
  return value === 'regular' || value === 'groom';
}

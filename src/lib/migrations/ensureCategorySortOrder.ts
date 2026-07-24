import type { ConnectionPool } from 'mssql';

let columnReady: boolean | null = null;

async function tblCatHasSortOrder(db: ConnectionPool): Promise<boolean> {
  const result = await db.request().query(`
    SELECT COUNT(*) AS cnt
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME = 'TblCat'
      AND COLUMN_NAME = 'SortOrder'
  `);
  return (result.recordset[0]?.cnt ?? 0) > 0;
}

/**
 * Idempotent — adds TblCat.SortOrder and backfills gaps.
 * Lower SortOrder = shown first.
 */
export async function ensureTblCatSortOrderColumn(db: ConnectionPool): Promise<boolean> {
  if (columnReady === true) return true;
  if (columnReady === false) return false;

  try {
    await db.request().query(`
      IF COL_LENGTH(N'dbo.TblCat', N'SortOrder') IS NULL
      BEGIN
        ALTER TABLE dbo.TblCat
        ADD SortOrder INT NOT NULL
          CONSTRAINT DF_TblCat_SortOrder DEFAULT (0);
      END;
    `);
  } catch (err) {
    console.warn('[ensureTblCatSortOrderColumn] ALTER TABLE failed:', err);
  }

  try {
    columnReady = await tblCatHasSortOrder(db);
    if (!columnReady) {
      console.warn('[ensureTblCatSortOrderColumn] SortOrder still missing');
      return false;
    }

    // Seed known salon display order once (only rows still at 0).
    await db.request().query(`
      UPDATE dbo.TblCat SET SortOrder = 10 WHERE SortOrder = 0 AND CatName = N'حلاقة';
      UPDATE dbo.TblCat SET SortOrder = 20 WHERE SortOrder = 0 AND LOWER(CatName) = N'skincare';
      UPDATE dbo.TblCat SET SortOrder = 30 WHERE SortOrder = 0 AND CatName = N'خدمات اضافيه للشعر';
      UPDATE dbo.TblCat SET SortOrder = 40 WHERE SortOrder = 0 AND CatName = N'معالجات شعر';
      UPDATE dbo.TblCat SET SortOrder = 50 WHERE SortOrder = 0 AND CatName = N'كريم شعر';

      ;WITH ranked AS (
        SELECT CatID,
          ROW_NUMBER() OVER (ORDER BY CatName) * 10 AS rn
        FROM dbo.TblCat
        WHERE SortOrder = 0
      )
      UPDATE c
      SET SortOrder = ranked.rn + 1000
      FROM dbo.TblCat c
      INNER JOIN ranked ON ranked.CatID = c.CatID;
    `);

    return true;
  } catch (err) {
    console.warn('[ensureTblCatSortOrderColumn] column check/backfill failed:', err);
    columnReady = false;
    return false;
  }
}

/** SELECT expression — safe before/after migration. */
export function tblCatSortOrderSelect(hasColumn: boolean, alias = 'c'): string {
  return hasColumn
    ? `${alias}.SortOrder`
    : 'CAST(0 AS INT) AS SortOrder';
}

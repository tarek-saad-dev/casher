import 'server-only';
import { getPool, sql } from '@/lib/db';
import type { CatalogItemKind, CatalogPort, ItemSnapshot } from '../public/ports';

function isProductRow(proType: unknown, catType: unknown): boolean {
  const productType = String(proType ?? '').trim().toLowerCase();
  const categoryType = String(catType ?? '').trim().toLowerCase();
  return (
    productType === 'pro' ||
    productType === 'product' ||
    categoryType === 'pro'
  );
}

function mapProRow(row: Record<string, unknown>): ItemSnapshot {
  const kind: CatalogItemKind = isProductRow(row.ProType, row.CatType)
    ? 'product'
    : 'service';
  return {
    catalogItemId: Number(row.ProID),
    name: String(row.ProName ?? ''),
    kind,
    basePrice: Number(row.SPrice1 ?? 0),
    durationMinutes: row.DurationMinutes != null ? Number(row.DurationMinutes) : null,
    sourceVersion: 'TblPro',
  };
}

const ITEM_SELECT = `
  SELECT
    p.ProID,
    p.ProName,
    ISNULL(p.SPrice1, 0) AS SPrice1,
    p.DurationMinutes,
    ISNULL(p.ProType, N'') AS ProType,
    ISNULL(c.CatType, N'') AS CatType
  FROM dbo.TblPro p
  LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
`;

/**
 * Anti-corruption adapter over legacy TblPro (sellable item) and TblCat (category).
 * Price and duration come from SPrice1 and DurationMinutes. TblCat is not an item.
 */
export function createLegacyCatalogAdapter(): CatalogPort {
  return {
    async getItem(_actor, catalogItemId) {
      const db = await getPool();
      const pro = await db
        .request()
        .input('id', sql.Int, catalogItemId)
        .query(`
          ${ITEM_SELECT}
          WHERE p.ProID = @id AND ISNULL(p.isDeleted, 0) = 0;
        `);
      if (!pro.recordset.length) return null;
      return mapProRow(pro.recordset[0] as Record<string, unknown>);
    },

    async listSellable(_actor, filter) {
      const db = await getPool();
      const kindClause =
        filter.kind === 'product'
          ? `AND (
              LOWER(ISNULL(p.ProType, N'')) IN (N'pro', N'product')
              OR LOWER(ISNULL(c.CatType, N'')) = N'pro'
            )`
          : filter.kind === 'service'
            ? `AND NOT (
              LOWER(ISNULL(p.ProType, N'')) IN (N'pro', N'product')
              OR LOWER(ISNULL(c.CatType, N'')) = N'pro'
            )`
            : '';
      const pro = await db.request().query(`
        ${ITEM_SELECT}
        WHERE ISNULL(p.isDeleted, 0) = 0
        ${kindClause}
        ORDER BY p.ProName;
      `);
      return (pro.recordset as Record<string, unknown>[]).map(mapProRow);
    },
  };
}

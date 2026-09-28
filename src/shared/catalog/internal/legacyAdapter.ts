import 'server-only';
import { getPool, sql } from '@/lib/db';
import type { ActorContext } from '@/platform/public';
import type { CatalogPort, ItemSnapshot } from '../public/ports';

function mapProRow(row: Record<string, unknown>): ItemSnapshot {
  return {
    catalogItemId: Number(row.ProID),
    name: String(row.ProName ?? ''),
    kind: 'service',
    basePrice: Number(row.ProPrice ?? 0),
    durationMinutes: row.Duration != null ? Number(row.Duration) : null,
    sourceVersion: 'TblPro',
  };
}

/** Anti-corruption adapter over legacy TblPro / TblCat. */
export function createLegacyCatalogAdapter(): CatalogPort {
  return {
    async getItem(_actor, catalogItemId) {
      const db = await getPool();
      const pro = await db
        .request()
        .input('id', sql.Int, catalogItemId)
        .query(`
          SELECT TOP 1 ProID, ProName, ProPrice, Duration
          FROM dbo.TblPro WITH (NOLOCK)
          WHERE ProID = @id AND ISNULL(isDeleted, 0) = 0;
        `);
      if (pro.recordset.length) {
        return mapProRow(pro.recordset[0] as Record<string, unknown>);
      }
      const cat = await db
        .request()
        .input('id', sql.Int, catalogItemId)
        .query(`
          SELECT TOP 1 CatID, CatName, CatPrice
          FROM dbo.TblCat WITH (NOLOCK)
          WHERE CatID = @id AND ISNULL(isDeleted, 0) = 0;
        `);
      if (!cat.recordset.length) return null;
      const row = cat.recordset[0] as Record<string, unknown>;
      return {
        catalogItemId: Number(row.CatID),
        name: String(row.CatName ?? ''),
        kind: 'product',
        basePrice: Number(row.CatPrice ?? 0),
        durationMinutes: null,
        sourceVersion: 'TblCat',
      };
    },

    async listSellable(_actor, filter) {
      const db = await getPool();
      const items: ItemSnapshot[] = [];
      if (filter.kind !== 'product') {
        const pro = await db.request().query(`
          SELECT ProID, ProName, ProPrice, Duration
          FROM dbo.TblPro WITH (NOLOCK)
          WHERE ISNULL(isDeleted, 0) = 0
          ORDER BY ProName;
        `);
        for (const row of pro.recordset as Record<string, unknown>[]) {
          items.push(mapProRow(row));
        }
      }
      if (filter.kind !== 'service') {
        const cat = await db.request().query(`
          SELECT CatID, CatName, CatPrice
          FROM dbo.TblCat WITH (NOLOCK)
          WHERE ISNULL(isDeleted, 0) = 0
          ORDER BY CatName;
        `);
        for (const row of cat.recordset as Record<string, unknown>[]) {
          items.push({
            catalogItemId: Number(row.CatID),
            name: String(row.CatName ?? ''),
            kind: 'product',
            basePrice: Number(row.CatPrice ?? 0),
            durationMinutes: null,
            sourceVersion: 'TblCat',
          });
        }
      }
      return items;
    },
  };
}

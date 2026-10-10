import type { ConnectionPool, Transaction } from 'mssql';
import { sql } from '@/lib/db';

type Executor = ConnectionPool | Transaction;

/** A category id is usable only by the tenant that owns it (cross-tenant ids look missing). */
export async function isTenantCategory(ex: Executor, tenantId: string, catId: number): Promise<boolean> {
  if (!Number.isInteger(catId) || catId <= 0) return false;
  const r = await new sql.Request(ex as ConnectionPool)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('catId', sql.Int, catId)
    .query(`SELECT 1 AS ok FROM dbo.TblCat WHERE CatID = @catId AND TenantId = @tenantId;`);
  return r.recordset.length > 0;
}

/** Service/product ids among `proIds` that the tenant does NOT own. */
export async function findForeignServiceIds(
  ex: Executor,
  tenantId: string,
  proIds: number[],
): Promise<number[]> {
  const ids = [...new Set(proIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return [];
  const r = await new sql.Request(ex as ConnectionPool)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT ProID FROM dbo.TblPro
      WHERE TenantId = @tenantId AND ProID IN (${ids.join(',')});
    `);
  const owned = new Set((r.recordset as Array<{ ProID: number }>).map((x) => Number(x.ProID)));
  return ids.filter((id) => !owned.has(id));
}

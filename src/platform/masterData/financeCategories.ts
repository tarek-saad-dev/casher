import type { ConnectionPool, Request, Transaction } from 'mssql';
import { sql } from '@/lib/db';
import { requireMasterDataTenantId } from '@/platform/masterData/tenantScope';

function requestOn(executor: ConnectionPool | Transaction): Request {
  return 'begin' in executor
    ? new sql.Request(executor as Transaction)
    : (executor as ConnectionPool).request();
}

/**
 * Find-or-create a named income/expense category inside one tenant. Another tenant's category
 * with the same name is never reused.
 */
export async function ensureTenantFinanceCategory(
  executor: ConnectionPool | Transaction,
  tenantId: string,
  catName: string,
  expInType: string,
): Promise<number> {
  const tid = requireMasterDataTenantId(tenantId, 'ensureTenantFinanceCategory');
  const found = await requestOn(executor)
    .input('tenantId', sql.UniqueIdentifier, tid)
    .input('catName', sql.NVarChar(200), catName)
    .input('expType', sql.NVarChar(50), expInType)
    .query(`
      SELECT TOP 1 ExpINID
      FROM dbo.TblExpINCat
      WHERE TenantId = @tenantId AND CatName = @catName AND ExpINType = @expType
      ORDER BY ExpINID
    `);
  if (found.recordset.length > 0) {
    return Number(found.recordset[0].ExpINID);
  }

  const inserted = await requestOn(executor)
    .input('tenantId', sql.UniqueIdentifier, tid)
    .input('catName', sql.NVarChar(200), catName)
    .input('expType', sql.NVarChar(50), expInType)
    .query(`
      INSERT INTO dbo.TblExpINCat (TenantId, CatName, ExpINType)
      OUTPUT INSERTED.ExpINID
      VALUES (@tenantId, @catName, @expType)
    `);
  return Number(inserted.recordset[0].ExpINID);
}

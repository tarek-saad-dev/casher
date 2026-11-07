import 'server-only';

import { getPool, sql } from '@/lib/db';
import type { Request as SqlRequest } from 'mssql';

/**
 * Serialize all mutations for a single employee/branch/work date. Keep the
 * ledger debit/void and case state in the SAME SQL transaction.
 */
export type LateCaseDb = { request: () => SqlRequest };

export async function withLateDeductionCaseLock<T>(
  key: { empId: number; branchId: number; workDate: string },
  callback: (db: LateCaseDb) => Promise<T>,
): Promise<T> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const resource = `late-deduction:${key.empId}:${key.branchId}:${key.workDate}`;
    const result = await new sql.Request(tx)
      .input('resource', sql.NVarChar(255), resource)
      .query(`
        DECLARE @result INT;
        EXEC @result = sp_getapplock
          @Resource = @resource,
          @LockMode = N'Exclusive',
          @LockOwner = N'Transaction',
          @LockTimeout = 15000;
        SELECT @result AS LockResult;
      `);
    if (Number(result.recordset[0]?.LockResult ?? -1) < 0) {
      throw new Error('Late deduction transaction lock not acquired');
    }
    const db: LateCaseDb = { request: () => new sql.Request(tx) };
    const value = await callback(db);
    await tx.commit();
    return value;
  } catch (error) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    throw error;
  }
}

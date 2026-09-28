import 'server-only';
import { getPool, sql } from '@/lib/db';
import type { UnitOfWorkContext, UnitOfWorkFn } from './types';

/**
 * DRVO Unit of Work — one SQL transaction on the shared database.
 * Callers must not commit or rollback inner transactions.
 */
export async function withUnitOfWork<T>(fn: UnitOfWorkFn<T>): Promise<T> {
  const db = await getPool();
  const transaction = new sql.Transaction(db);
  await transaction.begin();
  const ctx: UnitOfWorkContext = {
    transaction,
    request: () => new sql.Request(transaction),
  };
  try {
    const result = await fn(ctx);
    await transaction.commit();
    return result;
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* ignore rollback failure */
    }
    throw err;
  }
}

export async function withExistingTransaction<T>(
  transaction: sql.Transaction,
  fn: UnitOfWorkFn<T>,
): Promise<T> {
  const ctx: UnitOfWorkContext = {
    transaction,
    request: () => new sql.Request(transaction),
  };
  return fn(ctx);
}

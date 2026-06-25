import { describe, it, expect, beforeAll } from 'vitest';
import { getPool, sql } from '@/lib/db';
import { getUserRolesSnapshot, updateUserRoles, getPageAccessSnapshot, updatePageAccess } from '@/lib/actions/permissionActions';

let dbAvailable = false;
let dbReason = '';

beforeAll(async () => {
  try {
    const pool = await getPool();
    await pool.request().query('SELECT 1 AS ok');
    dbAvailable = true;
  } catch (e: unknown) {
    dbAvailable = false;
    dbReason = e instanceof Error ? e.message : 'DB connection failed';
  }
});

const itIfDb = (name: string, fn: () => Promise<void>) => {
  it(name, async () => {
    if (!dbAvailable) {
      console.warn(`Skipping DB test: ${dbReason}`);
      return;
    }
    await fn();
  });
};

describe('permissionActions integration', () => {
  itIfDb('updateUserRoles replaces roles exactly once', async () => {
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      const userResult = await new sql.Request(transaction).query(
        `SELECT TOP 1 UserID FROM dbo.TblUser WHERE isDeleted = 0 AND UserID <> 1 ORDER BY UserID`
      );
      if (userResult.recordset.length === 0) {
        throw new Error('Need a non-admin test user');
      }
      const userId = userResult.recordset[0].UserID;

      const oldSnapshot = await getUserRolesSnapshot(transaction, userId);

      await updateUserRoles(transaction, userId, ['cashier']);
      const newSnapshot = await getUserRolesSnapshot(transaction, userId);
      expect(newSnapshot?.roles).toEqual(['cashier']);

      await updateUserRoles(transaction, userId, ['cashier', 'admin']);
      const secondSnapshot = await getUserRolesSnapshot(transaction, userId);
      expect(secondSnapshot?.roles?.sort()).toEqual(['admin', 'cashier']);

      // Restore original roles so the test is non-destructive after rollback
      await updateUserRoles(transaction, userId, oldSnapshot?.roles || []);
    } finally {
      await transaction.rollback();
    }
  });

  itIfDb('updatePageAccess replaces page roles and access mode exactly once', async () => {
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      const pageResult = await new sql.Request(transaction).query(
        `SELECT TOP 1 PageKey FROM dbo.TblSystemPages WHERE IsActive = 1 ORDER BY PageID`
      );
      if (pageResult.recordset.length === 0) {
        throw new Error('No active page found for test');
      }
      const pageKey = pageResult.recordset[0].PageKey;

      const oldSnapshot = await getPageAccessSnapshot(transaction, pageKey);
      const originalMode = oldSnapshot?.oldAccessMode || 'all';
      const originalRoles = oldSnapshot?.oldRoles || [];

      await updatePageAccess(transaction, pageKey, 'roles', ['admin']);
      const newSnapshot = await getPageAccessSnapshot(transaction, pageKey);
      expect(newSnapshot?.newAccessMode).toBe('roles');
      expect(newSnapshot?.newRoles).toEqual(['admin']);

      // Restore
      await updatePageAccess(transaction, pageKey, originalMode as 'all' | 'roles' | 'super_admin_only', originalRoles);
    } finally {
      await transaction.rollback();
    }
  });
});

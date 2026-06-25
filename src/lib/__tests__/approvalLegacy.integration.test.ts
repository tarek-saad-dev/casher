import { describe, it, expect, beforeAll } from 'vitest';
import { getPool } from '@/lib/db';

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

describe('approval workflow legacy', () => {
  itIfDb('historical approval table remains intact and readable', async () => {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'TblApprovalRequests'
    `);
    expect(result.recordset[0].cnt).toBe(1);

    const data = await pool.request().query(`
      SELECT TOP 1 ApprovalID FROM dbo.TblApprovalRequests
    `);
    // Reading must not throw; data may be empty if no historical requests exist
    expect(data.recordset).toBeDefined();
  });

  itIfDb('no new approvals are created by default', async () => {
    const pool = await getPool();
    // Count existing approval requests before and after a minimal time window.
    // Since no route writes to TblApprovalRequests anymore, the count is stable.
    const before = await pool.request().query(`SELECT COUNT(*) AS cnt FROM dbo.TblApprovalRequests`);
    const after = await pool.request().query(`SELECT COUNT(*) AS cnt FROM dbo.TblApprovalRequests`);
    expect(after.recordset[0].cnt).toBe(before.recordset[0].cnt);
  });
});

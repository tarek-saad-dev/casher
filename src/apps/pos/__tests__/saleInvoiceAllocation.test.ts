import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Execute the allocator's relational query, rather than supplying a canned max.
// SQLite checks data semantics only; SQL Server locking still needs staging smoke.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const state = vi.hoisted(() => ({ db: null as any, lockResult: 0 }));
vi.mock('mssql', () => ({
  default: {
    Request: class {
      inputs: Record<string, string | number> = {};
      input(name: string, _type: unknown, value: string | number) {
        this.inputs[name] = value;
        return this;
      }
      async query(query: string) {
        if (query.includes('sp_getapplock')) {
          return { recordset: [{ lockResult: state.lockResult }] };
        }
        const portableQuery = query
          .replace(/WITH\s*\([^)]*\)/gi, '')
          .replace(/ISNULL\(/gi, 'COALESCE(');
        return { recordset: state.db.prepare(portableQuery).all(this.inputs) };
      }
    },
    NVarChar: (length: number) => length,
    Int: 0,
  },
}));

import { allocateInvID } from '@/lib/db';

describe('sale invoice allocation after Treasury reversal', () => {
  beforeEach(() => {
    state.lockResult = 0;
    state.db = new DatabaseSync(':memory:');
    state.db.exec(`
      ATTACH DATABASE ':memory:' AS dbo;
      CREATE TABLE dbo.TblinvServHead (invID INTEGER, invType TEXT);
      CREATE TABLE dbo.TblCashMove (invID INTEGER, invType TEXT, IsReversed INTEGER);
      INSERT INTO dbo.TblinvServHead VALUES (9825, 'مبيعات'), (9826, 'مبيعات');
      INSERT INTO dbo.TblCashMove VALUES (9826, 'مبيعات', 0);
    `);
  });
  afterEach(() => state.db.close());

  const allocate = (table = 'TblinvServHead', type = 'مبيعات') =>
    allocateInvID({} as any, table as any, type);

  it('does not reuse the highest invoice after delete preserves its reversed movement', async () => {
    state.db.exec(`
      DELETE FROM dbo.TblinvServHead WHERE invID = 9826;
      UPDATE dbo.TblCashMove SET IsReversed = 1 WHERE invID = 9826;
    `);
    expect(await allocate()).toBe(9827);
    state.db.exec(`INSERT INTO dbo.TblinvServHead VALUES (9827, 'مبيعات');`);
    expect(await allocate()).toBe(9828);
  });

  it('retains the high-water mark even when all sale headers were deleted', async () => {
    state.db.exec('DELETE FROM dbo.TblinvServHead; UPDATE dbo.TblCashMove SET IsReversed = 1;');
    expect(await allocate()).toBe(9827);
  });

  it('uses a newer header even when its Treasury movement is absent', async () => {
    state.db.exec(`INSERT INTO dbo.TblinvServHead VALUES (9900, 'مبيعات');`);
    expect(await allocate()).toBe(9901);
  });

  it('ignores other invoice types and preserves service invoice allocation', async () => {
    state.db.exec(`
      INSERT INTO dbo.TblCashMove VALUES (50000, 'ايرادات', 0), (60000, 'خدمة', 0);
      INSERT INTO dbo.TblinvServHead VALUES (42, 'خدمة');
    `);
    expect(await allocate()).toBe(9827);
    expect(await allocate('TblinvServHead', 'خدمة')).toBe(43);
    expect(await allocate('TblCashMove', 'ايرادات')).toBe(50001);
  });

  it('starts an empty sales namespace at one', async () => {
    state.db.exec('DELETE FROM dbo.TblinvServHead; DELETE FROM dbo.TblCashMove;');
    expect(await allocate()).toBe(1);
  });

  it('refuses allocation when the transaction lock cannot be acquired', async () => {
    state.lockResult = -1;
    await expect(allocate()).rejects.toMatchObject({ code: 'TREASURY_BUSY' });
  });
});

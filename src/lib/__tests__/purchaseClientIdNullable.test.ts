import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const sqlState = vi.hoisted(() => ({
  queries: [] as string[],
  inputBatches: [] as Array<Record<string, unknown>>,
  committed: 0,
  rolledBack: 0,
}));

vi.mock('@/lib/db', () => {
  class MockRequest {
    private inputs: Record<string, unknown> = {};
    input(name: string, _type: unknown, value: unknown) {
      this.inputs[name] = value;
      return this;
    }
    async query(text: string) {
      sqlState.queries.push(text);
      sqlState.inputBatches.push({ ...this.inputs });
      return { recordset: [{ newInvID: 41 }], rowsAffected: [1] };
    }
  }
  class MockTransaction {
    async begin() {}
    async commit() {
      sqlState.committed++;
    }
    async rollback() {
      sqlState.rolledBack++;
    }
  }
  return {
    getPool: vi.fn(async () => ({})),
    sql: {
      Request: MockRequest,
      Transaction: MockTransaction,
      ISOLATION_LEVEL: { SERIALIZABLE: 'SERIALIZABLE' },
      Int: 'Int',
      Date: 'Date',
      NVarChar: vi.fn((len?: number) => `NVarChar(${len})`),
      Decimal: vi.fn(() => 'Decimal'),
    },
  };
});

vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => ({ UserID: 7 })) }));

vi.mock('@/lib/branch', () => ({
  isActiveBranchContext: vi.fn(() => true),
  requireBranchOperationAccess: vi.fn(),
  resolveBranchDayAndShiftForWrite: vi.fn(async () => ({ ok: true })),
  lockOperationalWrite: vi.fn(async () => undefined),
  branchErrorResponse: vi.fn(() => null),
}));

vi.mock('@/lib/branch/financialOwnershipPolicy', () => ({
  finalizeCurrentFinancialWrite: vi.fn(() => ({
    ok: true,
    ownership: { branchId: 3, businessDayId: 55, businessDate: '2026-10-09', shiftMoveId: 12 },
  })),
}));

const postPurchaseReceipt = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/lib/inventory/purchaseInventory.service', () => ({
  postPurchaseReceipt,
  InventoryDomainError: class InventoryDomainError extends Error {},
}));

vi.mock('@/lib/businessDate', () => ({ getCairoInvTimeDotStr: () => '10.15' }));

const migration = fs.readFileSync(
  path.join(process.cwd(), 'db/migrations/allow-null-purchase-client-id.sql'),
  'utf8',
);

describe('allow-null-purchase-client-id migration', () => {
  it('refuses unexpected databases and stops later batches', () => {
    expect(migration).toContain('DECLARE @db SYSNAME = DB_NAME();');
    expect(migration).toContain("IF @db NOT IN (N'last132_agent', N'last132')");
    expect(migration).toContain('SET NOEXEC ON;');
    expect(migration.trimEnd()).toMatch(/SET NOEXEC OFF;\s*GO$/);
  });

  it('alters only while ClientID is NOT NULL, so reruns are no-ops', () => {
    const guardIdx = migration.indexOf("name = N'ClientID' AND is_nullable = 0");
    const alterIdx = migration.indexOf('ALTER COLUMN ClientID INT NULL');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(alterIdx).toBeGreaterThan(guardIdx);
    expect(migration).toContain('already allows NULL; nothing to do');
  });

  it('re-creates the ClientID foreign key with its original name, actions and trust state', () => {
    expect(migration).toContain('DROP CONSTRAINT');
    expect(migration).toContain("N' ADD CONSTRAINT ' + QUOTENAME(@fkName) + N' FOREIGN KEY (ClientID) REFERENCES '");
    expect(migration).toContain("CASE WHEN @notTrusted = 1 THEN N'NOCHECK' ELSE N'CHECK' END");
    expect(migration).toContain('ON DELETE');
    expect(migration).toContain('ON UPDATE');
    expect(migration).toContain('BEGIN TRANSACTION;');
    expect(migration).toContain('COMMIT TRANSACTION;');
    expect(migration).toContain('SET XACT_ABORT ON;');
  });

  it('does not backfill or touch purchase rows', () => {
    const body = migration.replace(/^\s*--.*$/gm, '');
    expect(body).not.toMatch(/\bUPDATE\s+dbo\.TblinvPurchaseHead\b/i);
    expect(body).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(body).not.toMatch(/\bINSERT\s+INTO\b/i);
  });
});

describe('POST /api/purchases without a supplier', () => {
  beforeEach(() => {
    sqlState.queries.length = 0;
    sqlState.inputBatches.length = 0;
    sqlState.committed = 0;
    sqlState.rolledBack = 0;
    postPurchaseReceipt.mockClear();
  });

  it('accepts { lines, notes, post } and inserts ClientID = NULL', async () => {
    const { POST } = await import('@/app/api/purchases/route');
    const req = new NextRequest('http://localhost/api/purchases', {
      method: 'POST',
      body: JSON.stringify({ lines: [{ proId: 9, qty: 5, unitPrice: 40 }], notes: 'restock', post: true }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ invID: 41, branchId: 3, businessDayId: 55, postStatus: 'POSTED' });

    const headIdx = sqlState.queries.findIndex((q) => q.includes('INSERT INTO dbo.TblinvPurchaseHead'));
    expect(headIdx).toBeGreaterThan(-1);
    expect(sqlState.queries[headIdx]).toMatch(/@invID, @invType, @invDate, @invTime, NULL, @UserID/);
    expect(sqlState.inputBatches[headIdx]).not.toHaveProperty('ClientID');
    expect(sqlState.inputBatches[headIdx]).toMatchObject({ BusinessDayID: 55, BranchID: 3 });
    expect(postPurchaseReceipt).toHaveBeenCalledTimes(1);
    expect(sqlState.committed).toBe(1);
    expect(sqlState.rolledBack).toBe(0);
  });
});

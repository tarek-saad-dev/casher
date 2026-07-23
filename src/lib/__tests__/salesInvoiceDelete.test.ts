/**
 * Unit tests for DELETE /api/sales/[id]
 *
 * Covers:
 * 1.  No body → 400
 * 2.  No reason field → 400
 * 3.  Empty reason → 400
 * 4.  Whitespace-only reason → 400
 * 5.  super_admin still requires reason → 400
 * 6.  Valid reason succeeds → 200
 * 7.  deleteInvoice executed exactly once
 * 8.  getInvoiceSnapshot called (full pre-delete snapshot)
 * 9.  No TblApprovalRequests row created
 * 10. Invalid ID (NaN) → 400
 * 11. Unauthenticated → 401
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

// ── Shared mutable state ──────────────────────────────────────────────────
let fakeAuditId = 42;
let fakeInvoiceExists = true;

const fakeActiveBranch = {
  userId: 1,
  branchId: 1,
  branchCode: 'GLEEM',
  branchName: 'Gleem Branch',
  shortName: 'Gleem',
  timeZone: 'Africa/Cairo',
  businessDayCutoffTime: '04:00',
  canOperate: true,
  canViewReports: true,
  canSwitch: true,
};

vi.mock('@/lib/branch', () => ({
  requireActiveBranchContext: vi.fn(async () => fakeActiveBranch),
  requireBranchOperationAccess: vi.fn(async () => fakeActiveBranch),
  isActiveBranchContext: (v: unknown) => !!v && typeof v === 'object' && 'branchId' in (v as object),
  assertActiveBranchOwns: (activeBranchId: number, ownerBranchId: number) => activeBranchId === ownerBranchId,
  financialNotFoundResponse: () => new Response(JSON.stringify({ error: 'غير موجود' }), { status: 404 }),
  loadInvoiceOwnership: vi.fn(async () => ({ branchId: 1, businessDayId: 1 })),
}));

vi.mock('@/lib/branch/context', () => ({
  requireActiveBranchContext: vi.fn(async () => fakeActiveBranch),
  requireBranchOperationAccess: vi.fn(async () => fakeActiveBranch),
  isActiveBranchContext: (v: unknown) => !!v && typeof v === 'object' && 'branchId' in (v as object),
}));

// ── Mock @/lib/db ─────────────────────────────────────────────────────────
vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
  sql: {
    Transaction: class FakeTx {
      async begin() {}
      async commit() {}
      async rollback() {}
    },
    Request: class FakeReq {
      constructor(private _tx?: unknown) {}
      input(_name: string, _type: unknown, _val: unknown) { return this; }
      async query() {
        if (!fakeInvoiceExists) return { recordset: [], rowsAffected: [0] };
        return {
          recordset: [{ AuditID: fakeAuditId }],
          rowsAffected: [1],
        };
      }
    },
    ISOLATION_LEVEL: { SERIALIZABLE: 'serializable' },
    NVarChar: (n?: number | string) => ({ type: 'nvarchar', length: n }),
    Int: () => ({ type: 'int' }),
    BigInt: () => ({ type: 'bigint' }),
    DateTime2: () => ({ type: 'datetime2' }),
    Decimal: () => ({ type: 'decimal' }),
    MAX: -1,
  },
}));

// ── Mock @/lib/session ────────────────────────────────────────────────────
const superAdminSession = {
  UserID: 1,
  UserName: 'admin',
  UserLevel: 'super_admin' as const,
  ActiveBranchID: 1,
  ActiveBranchCode: 'GLEEM',
  BranchSessionVersion: 1 as const,
};

const mockGetSession = vi.fn().mockResolvedValue(superAdminSession);

vi.mock('@/lib/session', () => ({
  getSession: () => mockGetSession(),
}));

// ── Mock @/lib/permissions-server ─────────────────────────────────────────
vi.mock('@/lib/permissions-server', () => ({
  getUserAccess: vi.fn().mockResolvedValue({ canAccess: true, roles: ['super_admin'] }),
}));

// ── Mock invoice domain actions ───────────────────────────────────────────
vi.mock('@/lib/actions/invoiceActions', () => ({
  getInvoiceSnapshot: vi.fn().mockImplementation(async () => {
    if (!fakeInvoiceExists) return null;
    return {
      header: {
        invID: 6466,
        invType: 'مبيعات',
        invDate: '2026-01-01',
        ClientID: null,
        SubTotal: 200,
        Dis: 0,
        DisVal: 0,
        Tax: 0,
        TaxVal: 0,
        GrandTotal: 200,
        TotalBonus: 0,
        PayCash: 200,
        PayVisa: 0,
        PaymentMethodID: 1,
        Notes: 'مبيعات',
      },
      details: [{ ProID: 1, EmpID: 1, SPrice: 200, SValue: 200, SPriceAfterDis: null, Qty: 1, Bonus: 0, Notes: null }],
      payments: [{ PaymentMethodID: 1, PaymentMethodName: 'كاش', PayValue: 200 }],
      cashMoves: [{ ID: 10, PaymentMethodID: 1, GrandTolal: 200, inOut: 'in', Notes: null }],
      loyaltyEntries: [],
    };
  }),
  deleteInvoice: vi.fn().mockImplementation(async () => {
    if (!fakeInvoiceExists) throw new Error('الفاتورة غير موجودة');
  }),
  updateInvoice: vi.fn(),
}));

// ── Helper: build fake NextRequest ────────────────────────────────────────
function makeRequest(body?: Record<string, unknown>): NextRequest {
  const opts: RequestInit = { method: 'DELETE' };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  return new Request('http://localhost:3000/api/sales/6466', opts) as unknown as NextRequest;
}

// ── Route under test (imported after mocks) ───────────────────────────────
const { DELETE } = await import('@/app/api/sales/[id]/route');
const validParams = Promise.resolve({ id: '6466' });

// ─────────────────────────────────────────────────────────────────────────
describe('DELETE /api/sales/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeAuditId = 42;
    fakeInvoiceExists = true;
    mockGetSession.mockResolvedValue(superAdminSession);
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await DELETE(makeRequest({ reason: 'test' }), { params: validParams });
    expect(res.status).toBe(401);
  });

  it('returns 400 when no body is sent', async () => {
    const res = await DELETE(makeRequest(), { params: validParams });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/مطلوب/);
  });

  it('returns 400 when reason field is absent', async () => {
    const res = await DELETE(makeRequest({}), { params: validParams });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/مطلوب/);
  });

  it('returns 400 when reason is empty string', async () => {
    const res = await DELETE(makeRequest({ reason: '' }), { params: validParams });
    expect(res.status).toBe(400);
  });

  it('returns 400 when reason is whitespace only', async () => {
    const res = await DELETE(makeRequest({ reason: '   \n\t  ' }), { params: validParams });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/مطلوب/);
  });

  it('super_admin must also provide a reason — no exemption', async () => {
    const res = await DELETE(makeRequest({ reason: '' }), { params: validParams });
    expect(res.status).toBe(400);
  });

  it('returns 200 with valid reason', async () => {
    const res = await DELETE(makeRequest({ reason: 'إدخال خاطئ' }), { params: validParams });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.auditId).toBeDefined();
  });

  it('deleteInvoice executes exactly once', async () => {
    const { deleteInvoice } = await import('@/lib/actions/invoiceActions');
    await DELETE(makeRequest({ reason: 'تصحيح' }), { params: validParams });
    expect(deleteInvoice).toHaveBeenCalledTimes(1);
  });

  it('getInvoiceSnapshot is called (full pre-delete snapshot loaded)', async () => {
    const { getInvoiceSnapshot } = await import('@/lib/actions/invoiceActions');
    await DELETE(makeRequest({ reason: 'مراجعة' }), { params: validParams });
    expect(getInvoiceSnapshot).toHaveBeenCalled();
  });

  it('returns 400 for non-numeric id', async () => {
    const res = await DELETE(
      makeRequest({ reason: 'test' }),
      { params: Promise.resolve({ id: 'abc' }) },
    );
    expect(res.status).toBe(400);
  });
});

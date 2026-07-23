/**
 * Unit tests for POST /api/treasury/transfer
 *
 * Covers:
 * 1.  Missing auth → 401
 * 2.  Invalid amount (NaN, <=0, Infinity) → 400
 * 3.  Amount exceeds decimal(10,2) → 400
 * 4.  Amount with >2 decimals → 400
 * 5.  Invalid fromPaymentMethodId (string, NaN, non-integer) → 400
 * 6.  Invalid toPaymentMethodId (null, non-integer) → 400
 * 7.  Same source and destination → 400
 * 8.  Invalid transferDate (not YYYY-MM-DD, impossible date) → 400
 * 9.  Future transferDate → 400
 * 10. Missing payment method → 404
 * 11. Valid historical transfer → 200
 * 12. Valid current transfer → 200
 * 13. Insufficient balance → 409
 * 14. Audited action error returns correct statusCode
 * 15. Unexpected error returns 500 with requestId
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

let fakeAuditResult = { success: true, auditId: 99, data: { expenseId: 1, incomeId: 2 } };
let shouldAuditThrow = false;
let auditError: unknown = null;

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(async () => ({ UserID: 1, UserName: 'test', UserLevel: 1 })),
}));

vi.mock('server-only', () => ({}));

const fakeBranch = {
  userId: 1,
  branchId: 7,
  branchCode: 'MAIN',
  branchName: 'Main Branch',
  shortName: 'Main',
  timeZone: 'Africa/Cairo',
  businessDayCutoffTime: '04:00',
  canOperate: true,
  canViewReports: true,
  canSwitch: true,
};
const fakeDay = { id: 42, branchId: 7, newDay: '2025-06-01', status: true };
const fakeShift = {
  id: 55,
  branchId: 7,
  businessDayId: 42,
  newDay: '2025-06-01',
  userId: 1,
  shiftId: 1,
  startDate: '2025-06-01',
  startTime: '08:00',
  endDate: null,
  endTime: null,
  status: true,
};

vi.mock('@/lib/branch/context', () => ({
  requireBranchOperationAccess: vi.fn(async () => fakeBranch),
}));

vi.mock('@/lib/branch/operationalGates', () => ({
  resolveBranchDayAndShiftForWrite: vi.fn(async () => ({
    ok: true,
    branch: fakeBranch,
    day: fakeDay,
    shift: fakeShift,
  })),
  resolveBranchDayForDate: vi.fn(async () => ({ ok: true, day: fakeDay })),
}));

vi.mock('@/lib/sensitiveActionAudit', () => ({
  executeAuditedAction: vi.fn(async (opts: any) => {
    if (shouldAuditThrow) throw auditError;
    const result = await opts.execute();
    return { success: true, auditId: fakeAuditResult.auditId, data: result };
  }),
  isAuditedActionError: vi.fn((err) => err && typeof err.failedAuditId === 'number'),
}));

vi.mock('@/lib/actions/treasuryActions', () => ({
  executeTreasuryTransfer: vi.fn(async (_tx, input) => ({
    expenseId: 1,
    incomeId: 2,
    expenseInvID: 101,
    incomeInvID: 201,
    amount: input.amount,
    fromPaymentMethodId: input.fromPaymentMethodId,
    toPaymentMethodId: input.toPaymentMethodId,
    fromPaymentMethod: 'Visa',
    toPaymentMethod: 'Instapay',
    notes: input.notes || 'test',
    transferDate: input.transferDate || new Date(),
    shiftMoveId: null,
  })),
  getPaymentMethodBalance: vi.fn(async () => 5000),
}));

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => ({
    request: vi.fn(() => {
      const self = {
        input: vi.fn().mockReturnThis(),
        query: vi.fn(async () => ({ recordset: [{ PaymentID: 1, PaymentMethod: 'Visa' }, { PaymentID: 2, PaymentMethod: 'Instapay' }] })),
      };
      self.input = vi.fn().mockReturnValue(self);
      return self;
    }),
  })),
  sql: {
    Int: () => {},
    Transaction: class FakeTx {
      async begin() {}
      async commit() {}
      async rollback() {}
    },
    ISOLATION_LEVEL: { SERIALIZABLE: 0 },
  },
}));

vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'test-request-id-123'),
}));

import { POST } from '@/app/api/treasury/transfer/route';
import { getSession } from '@/lib/session';
import { executeAuditedAction, isAuditedActionError } from '@/lib/sensitiveActionAudit';
import { executeTreasuryTransfer, getPaymentMethodBalance } from '@/lib/actions/treasuryActions';
import { getPool } from '@/lib/db';

describe('POST /api/treasury/transfer', () => {
  beforeEach(() => {
    fakeAuditResult = { success: true, auditId: 99, data: { expenseId: 1, incomeId: 2 } };
    shouldAuditThrow = false;
    auditError = null;
    vi.clearAllMocks();
  });

  function makeReq(body: unknown) {
    return new Request('http://localhost/api/treasury/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as unknown as NextRequest;
  }

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValueOnce(null);
    const res = await POST(makeReq({ amount: 100, fromPaymentMethodId: 1, toPaymentMethodId: 2 }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain('تسجيل الدخول');
  });

  it('returns 400 for NaN amount', async () => {
    const res = await POST(makeReq({ amount: 'abc', fromPaymentMethodId: 1, toPaymentMethodId: 2 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('المبلغ');
    expect(json.requestId).toBe('test-request-id-123');
  });

  it('returns 400 for zero amount', async () => {
    const res = await POST(makeReq({ amount: 0, fromPaymentMethodId: 1, toPaymentMethodId: 2 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('المبلغ');
  });

  it('returns 400 for negative amount', async () => {
    const res = await POST(makeReq({ amount: -50, fromPaymentMethodId: 1, toPaymentMethodId: 2 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('المبلغ');
  });

  it('returns 400 for Infinity amount', async () => {
    const res = await POST(makeReq({ amount: Infinity, fromPaymentMethodId: 1, toPaymentMethodId: 2 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('المبلغ');
  });

  it('returns 400 when amount exceeds decimal(10,2)', async () => {
    const res = await POST(makeReq({ amount: 100000000, fromPaymentMethodId: 1, toPaymentMethodId: 2 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('يتجاوز');
  });

  it('returns 400 when amount has more than 2 decimals', async () => {
    const res = await POST(makeReq({ amount: 100.999, fromPaymentMethodId: 1, toPaymentMethodId: 2 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('منزلتين');
  });

  it('returns 400 for non-integer fromPaymentMethodId', async () => {
    const res = await POST(makeReq({ amount: 100, fromPaymentMethodId: 1.5, toPaymentMethodId: 2 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('المصدر');
  });

  it('returns 400 for string fromPaymentMethodId', async () => {
    const res = await POST(makeReq({ amount: 100, fromPaymentMethodId: 'visa', toPaymentMethodId: 2 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('المصدر');
  });

  it('returns 400 for null toPaymentMethodId', async () => {
    const res = await POST(makeReq({ amount: 100, fromPaymentMethodId: 1, toPaymentMethodId: null }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('الهدف');
  });

  it('returns 400 when source equals destination', async () => {
    const res = await POST(makeReq({ amount: 100, fromPaymentMethodId: 1, toPaymentMethodId: 1 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('طرق دفع مختلفة');
  });

  it('returns 400 for malformed transferDate', async () => {
    const res = await POST(makeReq({ amount: 100, fromPaymentMethodId: 1, toPaymentMethodId: 2, transferDate: 'not-a-date' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('YYYY-MM-DD');
  });

  it('returns 400 for impossible date like 2026-02-31', async () => {
    const res = await POST(makeReq({ amount: 100, fromPaymentMethodId: 1, toPaymentMethodId: 2, transferDate: '2026-02-31' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('غير صالح');
  });

  it('returns 400 for future transferDate', async () => {
    const future = new Date();
    future.setDate(future.getDate() + 10);
    const dateStr = future.toISOString().split('T')[0];
    const res = await POST(makeReq({ amount: 100, fromPaymentMethodId: 1, toPaymentMethodId: 2, transferDate: dateStr }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('المستقبل');
  });

  it('returns 404 when a payment method does not exist', async () => {
    vi.mocked(getPool).mockResolvedValueOnce({
      request: vi.fn(() => {
        const self = {
          input: vi.fn().mockReturnThis(),
          query: vi.fn(async () => ({ recordset: [{ PaymentID: 1, PaymentMethod: 'Visa' }] })),
        };
        self.input = vi.fn().mockReturnValue(self);
        return self;
      }),
    } as any);
    const res = await POST(makeReq({ amount: 100, fromPaymentMethodId: 1, toPaymentMethodId: 999 }));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain('غير موجودة');
  });

  it('returns 200 for valid historical transfer', async () => {
    const res = await POST(makeReq({
      amount: 10410,
      fromPaymentMethodId: 1,
      toPaymentMethodId: 2,
      transferDate: '2025-01-15',
      notes: 'Visa to Instapay',
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.requestId).toBe('test-request-id-123');
    expect(json.auditId).toBe(99);

    const executeCall = vi.mocked(executeTreasuryTransfer).mock.calls[0][1];
    expect(executeCall.amount).toBe(10410);
    expect(executeCall.fromPaymentMethodId).toBe(1);
    expect(executeCall.toPaymentMethodId).toBe(2);
    expect(executeCall.transferDate).toBe('2025-01-15');
    expect(executeCall.requestId).toBe('test-request-id-123');
    expect(executeCall.branchId).toBe(fakeBranch.branchId);
    expect(executeCall.businessDayId).toBe(fakeDay.id);
  });

  it('returns 200 for valid current-day transfer', async () => {
    const res = await POST(makeReq({
      amount: 500,
      fromPaymentMethodId: 3,
      toPaymentMethodId: 4,
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    const executeCall = vi.mocked(executeTreasuryTransfer).mock.calls[0][1];
    expect(executeCall.transferDate).toBeUndefined();
    expect(executeCall.branchId).toBe(fakeBranch.branchId);
    expect(executeCall.businessDayId).toBe(fakeDay.id);
    expect(executeCall.shiftMoveId).toBe(fakeShift.id);
  });

  it('returns 409 when audited action reports insufficient balance', async () => {
    shouldAuditThrow = true;
    auditError = { message: 'رصيد غير كاف', failedAuditId: 88, statusCode: 409 };
    vi.mocked(isAuditedActionError).mockReturnValueOnce(true);

    const res = await POST(makeReq({ amount: 100, fromPaymentMethodId: 1, toPaymentMethodId: 2 }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.requestId).toBe('test-request-id-123');
    expect(json.auditId).toBe(88);
  });

  it('returns 500 with requestId on audited action error without statusCode', async () => {
    shouldAuditThrow = true;
    auditError = { message: 'Some internal error', failedAuditId: 77 };
    vi.mocked(isAuditedActionError).mockReturnValueOnce(true);

    const res = await POST(makeReq({ amount: 100, fromPaymentMethodId: 1, toPaymentMethodId: 2 }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.requestId).toBe('test-request-id-123');
    expect(json.auditId).toBe(77);
  });

  it('returns 500 with requestId on unexpected error', async () => {
    shouldAuditThrow = true;
    auditError = new Error('Unexpected boom');
    vi.mocked(isAuditedActionError).mockReturnValueOnce(false);

    const res = await POST(makeReq({ amount: 100, fromPaymentMethodId: 1, toPaymentMethodId: 2 }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.requestId).toBe('test-request-id-123');
    expect(json.error).toContain('Unexpected boom');
  });

  it('loads pre-transfer balances sequentially inside the audited transaction', async () => {
    const balanceCallOrder: string[] = [];
    vi.mocked(getPaymentMethodBalance).mockImplementation(async (_tx, pmId) => {
      balanceCallOrder.push(`start:${pmId}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      balanceCallOrder.push(`end:${pmId}`);
      return 5000;
    });

    vi.mocked(executeAuditedAction).mockImplementationOnce(async (opts: any) => {
      const tx = {};
      if (opts.loadOldData) await opts.loadOldData(tx);
      const result = await opts.execute(tx);
      if (opts.loadNewData) await opts.loadNewData(tx, result);
      return { success: true, auditId: 99, data: result };
    });

    const res = await POST(makeReq({
      amount: 10410,
      fromPaymentMethodId: 1,
      toPaymentMethodId: 2,
      transferDate: '2025-01-15',
    }));

    expect(res.status).toBe(200);
    expect(balanceCallOrder).toEqual([
      'start:1', 'end:1', 'start:2', 'end:2',
      'start:1', 'end:1', 'start:2', 'end:2',
    ]);
  });

  it('runs execute only after loadOldData completes', async () => {
    const callOrder: string[] = [];
    vi.mocked(getPaymentMethodBalance).mockImplementation(async (_tx, pmId) => {
      callOrder.push(`balance:${pmId}`);
      return 5000;
    });

    vi.mocked(executeAuditedAction).mockImplementationOnce(async (opts: any) => {
      const tx = {};
      if (opts.loadOldData) {
        callOrder.push('loadOldData:start');
        await opts.loadOldData(tx);
        callOrder.push('loadOldData:end');
      }
      callOrder.push('execute:start');
      const result = await opts.execute(tx);
      callOrder.push('execute:end');
      return { success: true, auditId: 99, data: result };
    });

    await POST(makeReq({
      amount: 500,
      fromPaymentMethodId: 3,
      toPaymentMethodId: 4,
      transferDate: '2025-01-15',
    }));

    expect(callOrder.indexOf('loadOldData:end')).toBeLessThan(callOrder.indexOf('execute:start'));
    expect(callOrder).toEqual([
      'loadOldData:start',
      'balance:3',
      'balance:4',
      'loadOldData:end',
      'execute:start',
      'execute:end',
    ]);
  });
});

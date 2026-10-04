import { readFileSync } from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type ShiftRow = { ID: number; UserID: number; BranchID: number; BusinessDayID: number; Status: boolean | number };

const SESSION = { UserID: 7, UserName: 'cashier', UserLevel: 'user' };
const BRANCH = { branchId: 3, branchCode: 'GLEEM' };

function setup(opts: {
  shiftReads: ShiftRow[];
  audited?: (options: Record<string, unknown>) => Promise<unknown>;
}) {
  const reads = [...opts.shiftReads];
  const poolQuery = vi.fn(async () => ({ recordset: reads.length > 1 ? [reads.shift()!] : [reads[0]] }));
  const executeAuditedAction = vi.fn(
    opts.audited ??
      (async () => {
        throw new Error('executeAuditedAction must not run');
      }),
  );

  class AuditedActionError extends Error {
    constructor(message: string, public failedAuditId: number, public statusCode = 500) {
      super(message);
    }
  }

  vi.doMock('@/lib/db', () => ({
    getPool: async () => ({
      request: () => {
        const req = { input: () => req, query: poolQuery };
        return req;
      },
    }),
  }));
  vi.doMock('mssql', () => ({ default: { Int: 'Int', Request: class {} } }));
  vi.doMock('@/lib/session', () => ({ getSession: async () => SESSION }));
  vi.doMock('@/lib/permissions', () => ({ hasPermission: () => true }));
  vi.doMock('@/lib/branch/context', () => ({ isActiveBranchContext: () => true }));
  vi.doMock('@/lib/branch/operationalGates', () => ({
    requireBranchOperatorContext: async () => BRANCH,
    branchErrorResponse: () => null,
  }));
  vi.doMock('@/lib/actions/treasuryActions', () => ({ closeTreasuryShift: vi.fn() }));
  vi.doMock('@/lib/sensitiveActionAudit', () => ({
    executeAuditedAction,
    isAuditedActionError: (e: unknown) => e instanceof AuditedActionError,
  }));

  return { executeAuditedAction, poolQuery, AuditedActionError };
}

function post(body: unknown) {
  return new Request('http://localhost/api/treasury/shift-reconciliation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

describe('POST /api/treasury/shift-reconciliation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('never reads TblTreasuryCloseRecon.VarianceAmount (absent in production schema)', () => {
    for (const rel of [
      'src/app/api/treasury/shift-reconciliation/route.ts',
      'src/app/api/treasury/reconciliation/route.ts',
    ]) {
      const src = readFileSync(path.join(process.cwd(), rel), 'utf8');
      const postSection = src.split('export async function GET')[0];
      expect(postSection).not.toMatch(/r\.VarianceAmount\s*,/);
    }
  });

  it('returns a controlled success when the caller re-submits for their already-closed shift', async () => {
    const { executeAuditedAction } = setup({
      shiftReads: [{ ID: 42, UserID: 7, BranchID: 3, BusinessDayID: 99, Status: false }],
    });
    const { POST } = await import('@/app/api/treasury/shift-reconciliation/route');
    const res = await POST(post({ shiftMoveId: 42, reconciliations: [] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, alreadyClosed: true, shiftMoveId: 42 });
    expect(executeAuditedAction).not.toHaveBeenCalled();
  });

  it('rejects with 409 when the closed shift belongs to another user', async () => {
    const { executeAuditedAction } = setup({
      shiftReads: [{ ID: 42, UserID: 55, BranchID: 3, BusinessDayID: 99, Status: 0 }],
    });
    const { POST } = await import('@/app/api/treasury/shift-reconciliation/route');
    const res = await POST(post({ shiftMoveId: 42, reconciliations: [] }));
    expect(res.status).toBe(409);
    expect(executeAuditedAction).not.toHaveBeenCalled();
  });

  it('treats a concurrent duplicate (double click) as already closed instead of a 500', async () => {
    const errorClass: { ctor?: new (m: string, id: number, s?: number) => Error } = {};
    const ctx = setup({
      shiftReads: [
        { ID: 42, UserID: 7, BranchID: 3, BusinessDayID: 99, Status: 1 },
        { ID: 42, UserID: 7, BranchID: 3, BusinessDayID: 99, Status: 0 },
      ],
      audited: async () => {
        throw new errorClass.ctor!('هذه الوردية مغلقة بالفعل', 12, 409);
      },
    });
    errorClass.ctor = ctx.AuditedActionError;
    const { POST } = await import('@/app/api/treasury/shift-reconciliation/route');
    const res = await POST(post({ shiftMoveId: 42, reconciliations: [] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, alreadyClosed: true });
  });

  it('closes an open shift through the audited action scoped to the active branch and caller', async () => {
    const audited = vi.fn(async (options: Record<string, unknown>) => {
      const execute = options.execute as (tx: unknown) => Promise<unknown>;
      await execute({});
      return {
        success: true,
        auditId: 900,
        data: { shiftMoveId: 42, businessDayId: 99, reconciliationIds: [], variances: [], closedByUserId: 7 },
      };
    });
    setup({
      shiftReads: [{ ID: 42, UserID: 7, BranchID: 3, BusinessDayID: 99, Status: 1 }],
      audited,
    });
    const { POST } = await import('@/app/api/treasury/shift-reconciliation/route');
    const { closeTreasuryShift } = await import('@/lib/actions/treasuryActions');
    const res = await POST(post({ shiftMoveId: 42, reconciliations: [] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, shiftMoveId: 42, auditId: 900 });
    expect(closeTreasuryShift).toHaveBeenCalledWith({}, expect.objectContaining({
      shiftMoveId: 42,
      branchId: 3,
      closedByUserId: 7,
    }));
  });
});

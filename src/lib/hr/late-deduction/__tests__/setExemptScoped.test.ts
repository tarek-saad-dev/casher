import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = {
  getPool: vi.fn(),
  schemaOk: vi.fn(async () => true),
};

vi.mock('@/lib/db', () => ({
  getPool: (...a: unknown[]) => m.getPool(...a),
  sql: {
    Int: 'Int',
    Bit: 'Bit',
    UniqueIdentifier: 'UniqueIdentifier',
  },
}));
vi.mock('../schema', () => ({
  isLateDeductionSchemaReady: (...a: unknown[]) => m.schemaOk(...a),
}));
vi.mock('../caseTransaction', () => ({
  withLateDeductionCaseLock: vi.fn(),
}));
vi.mock('../ledger', () => ({
  upsertLateDeductionLedgerEntry: vi.fn(),
  voidLateDeductionLedgerEntry: vi.fn(),
}));
vi.mock('../whatsapp', () => ({
  scheduleLateDeductionWhatsApp: vi.fn(),
}));
vi.mock('../messages', () => ({
  buildManagerDecisionEmployeeMessage: vi.fn(),
}));
vi.mock('../repository', () => ({
  findLateDeductionCaseById: vi.fn(),
  listPendingManagerCases: vi.fn(),
}));

describe('setEmployeeLateDeductionExempt scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.schemaOk.mockResolvedValue(true);
  });

  it('rejects employees not assigned to the active branch/tenant', async () => {
    const query = vi.fn(async () => ({ recordset: [] }));
    const input = vi.fn(function (this: { query: typeof query }) {
      return this;
    });
    m.getPool.mockResolvedValue({
      request: () => {
        const chain = { input, query };
        input.mockReturnValue(chain);
        return chain;
      },
    });

    const { setEmployeeLateDeductionExempt, LateDeductionActionError } = await import(
      '../managerActions'
    );
    await expect(
      setEmployeeLateDeductionExempt({
        empId: 99,
        exempt: true,
        tenantId: '11111111-1111-1111-1111-111111111111',
        branchId: 10,
      }),
    ).rejects.toBeInstanceOf(LateDeductionActionError);
  });

  it('updates LateDeductionExempt when employee is in scope', async () => {
    let call = 0;
    const query = vi.fn(async () => {
      call += 1;
      if (call === 1) return { recordset: [{ Allowed: 1 }] };
      return {
        recordset: [{ LateDeductionExempt: true }],
        recordsets: [[{}], [{ LateDeductionExempt: true }]],
      };
    });
    const input = vi.fn(function (this: { query: typeof query }) {
      return this;
    });
    m.getPool.mockResolvedValue({
      request: () => {
        const chain = { input, query };
        input.mockReturnValue(chain);
        return chain;
      },
    });

    const { setEmployeeLateDeductionExempt } = await import('../managerActions');
    await expect(
      setEmployeeLateDeductionExempt({
        empId: 42,
        exempt: true,
        tenantId: '11111111-1111-1111-1111-111111111111',
        branchId: 10,
      }),
    ).resolves.toEqual({ empId: 42, lateDeductionExempt: true });
  });
});

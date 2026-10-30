import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

const originalFlag = process.env.EMP_LEDGER_DUAL_WRITE_ENABLED;

let fakeCommit = vi.fn();
let fakeRollback = vi.fn();
let txQueryResults: Array<{ recordset?: unknown[]; rowsAffected?: number[] }> = [];
let txQueryIdx = 0;
let poolQueryResults: Array<{ recordset?: unknown[] }> = [];
let poolQueryIdx = 0;

function resetMocks() {
  fakeCommit = vi.fn();
  fakeRollback = vi.fn();
  txQueryResults = [];
  txQueryIdx = 0;
  poolQueryResults = [];
  poolQueryIdx = 0;
}

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => ({
    request: vi.fn(() => ({
      input: vi.fn().mockReturnThis(),
      query: vi.fn(async () => {
        const res = poolQueryResults[poolQueryIdx] ?? { recordset: [] };
        poolQueryIdx++;
        return res;
      }),
    })),
  })),
  allocateInvID: vi.fn(async () => 7001),
  sql: {
    Int: () => ({ type: 'int' }),
    BigInt: () => ({ type: 'bigint' }),
    Date: () => ({ type: 'date' }),
    Decimal: () => ({ type: 'decimal' }),
    NVarChar: (n: unknown) => ({ type: 'nvarchar', length: n }),
    MAX: -1,
    Request: class FakeRequest {
      inputs: Record<string, unknown> = {};
      input(name: string, _type: unknown, value?: unknown) {
        if (arguments.length >= 3) this.inputs[name] = value;
        return this;
      }
      async query() {
        const res = txQueryResults[txQueryIdx] ?? { recordset: [], rowsAffected: [0] };
        txQueryIdx++;
        return res;
      }
    },
    Transaction: class FakeTx {
      async begin() {}
      async commit() {
        fakeCommit();
      }
      async rollback() {
        fakeRollback();
      }
    },
    ISOLATION_LEVEL: { SERIALIZABLE: 0 },
  },
}));

vi.mock('@/lib/branch/repository', () => ({
  listActiveBranches: vi.fn(async () => [
    {
      branchId: 1,
      branchCode: 'GLEEM',
      branchName: 'جليم',
      lifecycleStatus: 'LIVE',
    },
    {
      branchId: 2,
      branchCode: 'CAMP_CAESAR',
      branchName: 'كامب شيزار',
      lifecycleStatus: 'LIVE',
    },
  ]),
}));

vi.mock('@/lib/services/employeeLedgerService', () => ({
  getEmployeeBranchBalance: vi.fn(),
  getEmployeeMonthlyBranchBalance: vi.fn(),
  validateLedgerMonth: vi.fn((m: string) =>
    /^\d{4}-\d{2}$/.test(m) ? null : 'month غير صالح',
  ),
}));

afterEach(() => {
  if (originalFlag === undefined) {
    delete process.env.EMP_LEDGER_DUAL_WRITE_ENABLED;
  } else {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = originalFlag;
  }
  vi.resetModules();
  vi.clearAllMocks();
});

describe('executeInterBranchSettlement', () => {
  beforeEach(() => {
    resetMocks();
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    vi.resetModules();
  });

  it('rolls back when amount exceeds available settlement', async () => {
    const { getEmployeeMonthlyBranchBalance } = await import(
      '@/lib/services/employeeLedgerService'
    );
    vi.mocked(getEmployeeMonthlyBranchBalance)
      .mockResolvedValueOnce(100) // source
      .mockResolvedValueOnce(-50); // dest → max 50

    const { executeInterBranchSettlement, EmployeeLedgerInterBranchSettlementError } =
      await import('@/lib/services/employeeLedgerInterBranchSettlementService');

    await expect(
      executeInterBranchSettlement({
        empId: 10,
        sourceBranchId: 1,
        destBranchId: 2,
        amount: 80,
        settlementDate: '2026-10-15',
        payrollMonth: '2026-10',
        settlementType: 'ledger_only',
        sourceBusinessDayId: 101,
        destBusinessDayId: 202,
        createdByUserId: 1,
      }),
    ).rejects.toBeInstanceOf(EmployeeLedgerInterBranchSettlementError);

    expect(fakeRollback).toHaveBeenCalled();
    expect(fakeCommit).not.toHaveBeenCalled();
  });

  it('commits ledger_only settlement and keeps company total unchanged', async () => {
    const { getEmployeeMonthlyBranchBalance } = await import(
      '@/lib/services/employeeLedgerService'
    );
    vi.mocked(getEmployeeMonthlyBranchBalance)
      .mockResolvedValueOnce(500) // pre source
      .mockResolvedValueOnce(-200) // pre dest
      .mockResolvedValueOnce(300) // post source
      .mockResolvedValueOnce(0); // post dest

    // INSERT header → SettlementID
    txQueryResults = [
      { recordset: [{ SettlementID: 55 }] },
      // source ledger
      { recordset: [{ ID: 1001 }] },
      // dest ledger
      { recordset: [{ ID: 1002 }] },
      // update header links
      { recordset: [], rowsAffected: [1] },
    ];

    const { executeInterBranchSettlement } = await import(
      '@/lib/services/employeeLedgerInterBranchSettlementService'
    );

    const result = await executeInterBranchSettlement({
      empId: 10,
      sourceBranchId: 1,
      destBranchId: 2,
      amount: 200,
      settlementDate: '2026-10-15',
      payrollMonth: '2026-10',
      settlementType: 'ledger_only',
      sourceBusinessDayId: 101,
      destBusinessDayId: 202,
      createdByUserId: 1,
      idempotencyKey: 'test-key-settle-200',
    });

    expect(result.settlementId).toBe(55);
    expect(result.sourceCashMoveId).toBeNull();
    expect(result.destCashMoveId).toBeNull();
    expect(result.totalBefore).toBe(300);
    expect(result.totalAfter).toBe(300);
    expect(fakeCommit).toHaveBeenCalled();
    expect(fakeRollback).not.toHaveBeenCalled();
  });

  it('replays idempotent settlement without inserting again', async () => {
    poolQueryResults = [
      {
        recordset: [
          {
            SettlementID: 77,
            Amount: 50,
            SettlementType: 'ledger_only',
            SourceBranchID: 1,
            DestBranchID: 2,
            SourceCashMoveID: null,
            DestCashMoveID: null,
            SourceLedgerEntryID: 1,
            DestLedgerEntryID: 2,
            IsVoided: false,
          },
        ],
      },
    ];

    const { getEmployeeMonthlyBranchBalance } = await import(
      '@/lib/services/employeeLedgerService'
    );
    vi.mocked(getEmployeeMonthlyBranchBalance)
      .mockResolvedValueOnce(450)
      .mockResolvedValueOnce(-150);

    const { executeInterBranchSettlement } = await import(
      '@/lib/services/employeeLedgerInterBranchSettlementService'
    );

    const result = await executeInterBranchSettlement({
      empId: 10,
      sourceBranchId: 1,
      destBranchId: 2,
      amount: 50,
      settlementDate: '2026-10-15',
      payrollMonth: '2026-10',
      settlementType: 'ledger_only',
      sourceBusinessDayId: 101,
      destBusinessDayId: 202,
      createdByUserId: 1,
      idempotencyKey: 'idem-replay-1',
    });

    expect(result.idempotentReplay).toBe(true);
    expect(result.settlementId).toBe(77);
    expect(fakeCommit).not.toHaveBeenCalled();
  });

  it('rejects same-branch settlement', async () => {
    const { executeInterBranchSettlement } = await import(
      '@/lib/services/employeeLedgerInterBranchSettlementService'
    );

    await expect(
      executeInterBranchSettlement({
        empId: 10,
        sourceBranchId: 1,
        destBranchId: 1,
        amount: 10,
        settlementDate: '2026-10-15',
        payrollMonth: '2026-10',
        settlementType: 'ledger_only',
        sourceBusinessDayId: 101,
        destBusinessDayId: 101,
        createdByUserId: 1,
      }),
    ).rejects.toThrow(/نفس الفرع/);
  });

  it('Huda-style: month max is min(gleemPos, abs(campNeg)) not lifetime leak', async () => {
    const { computeMaxSettlementAmount, projectBalancesAfterSettlement } = await import(
      '@/lib/hr/interBranchSettlementMath'
    );
    // October: Camp advances 1285 only; Gleem positive after wages/funding
    expect(computeMaxSettlementAmount(1563.68, -1285)).toBe(1285);
    const p = projectBalancesAfterSettlement({
      sourceBalance: 1563.68,
      destBalance: -1285,
      amount: 1285,
    });
    expect(p.destAfter).toBe(0);
    expect(p.totalBefore).toBe(p.totalAfter);
    // Lifetime-style 1876.17 must not be used when month debt is only 1285
    expect(computeMaxSettlementAmount(1876.17, -1285)).toBe(1285);
  });
});

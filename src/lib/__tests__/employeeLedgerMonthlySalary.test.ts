import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

const ORIG_FLAG = process.env.EMP_LEDGER_DUAL_WRITE_ENABLED;

let fakeCommit = vi.fn();
let fakeRollback = vi.fn();
let poolQueryResults: Array<{ recordset: unknown[]; rowsAffected?: number[] }> = [];
let poolQueryIdx = 0;
let txQueryResults: Array<{ recordset?: unknown[]; rowsAffected?: number[] }> = [];
let txQueryIdx = 0;

const fakeGetPool = vi.fn(async () => {
  poolQueryIdx = 0;
  return {
    request: vi.fn(() => ({
      input: vi.fn().mockReturnThis(),
      query: vi.fn(async () => {
        const res = poolQueryResults[poolQueryIdx] ?? { recordset: [] };
        poolQueryIdx++;
        return res;
      }),
    })),
  };
});

vi.mock('@/lib/db', () => ({
  getPool: () => fakeGetPool(),
  sql: {
    Int: () => ({ type: 'int' }),
    Date: () => ({ type: 'date' }),
    Decimal: () => ({ type: 'decimal' }),
    NVarChar: (n: unknown) => ({ type: 'nvarchar', length: n }),
    Request: class FakeRequest {
      input() {
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
  },
}));

function resetMocks() {
  fakeCommit = vi.fn();
  fakeRollback = vi.fn();
  poolQueryResults = [];
  poolQueryIdx = 0;
  txQueryResults = [];
  txQueryIdx = 0;
  fakeGetPool.mockClear();
}

afterEach(() => {
  if (ORIG_FLAG === undefined) delete process.env.EMP_LEDGER_DUAL_WRITE_ENABLED;
  else process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = ORIG_FLAG;
  resetMocks();
  vi.resetModules();
});

describe('employeeLedgerMonthlySalaryService helpers', () => {
  it('buildMonthlySalaryRefType uses Option B idempotency', async () => {
    const mod = await import('@/lib/services/employeeLedgerMonthlySalaryService');
    expect(mod.buildMonthlySalaryRefType('2026-07')).toBe('MonthlySalary:2026-07');
  });

  it('classifyMonthlySalaryRow detects update vs already posted', async () => {
    const mod = await import('@/lib/services/employeeLedgerMonthlySalaryService');
    expect(mod.classifyMonthlySalaryRow(2000, null, '2026-07-31', mod.buildMonthlySalaryNote('2026-07'))).toBe('new');
    const existing = { id: 1, amount: 2000, entryDate: '2026-07-31', notes: mod.buildMonthlySalaryNote('2026-07') };
    expect(mod.classifyMonthlySalaryRow(2000, existing, '2026-07-31', mod.buildMonthlySalaryNote('2026-07'))).toBe('alreadyPosted');
    expect(mod.classifyMonthlySalaryRow(2500, existing, '2026-07-31', mod.buildMonthlySalaryNote('2026-07'))).toBe('willUpdate');
  });
});

describe('postMonthlySalaryEntitlements', () => {
  beforeEach(() => {
    resetMocks();
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
  });

  async function loadService() {
    return import('@/lib/services/employeeLedgerMonthlySalaryService');
  }

  it('rejects when dual-write flag is false', async () => {
    delete process.env.EMP_LEDGER_DUAL_WRITE_ENABLED;
    const { postMonthlySalaryEntitlements, EmployeeLedgerMonthlySalaryError } = await loadService();
    await expect(postMonthlySalaryEntitlements({ month: '2026-07', dryRun: true }))
      .rejects.toThrow(EmployeeLedgerMonthlySalaryError);
    expect(fakeGetPool).not.toHaveBeenCalled();
  });

  it('dryRun writes nothing and returns preview rows', async () => {
    poolQueryResults = [
      {
        recordset: [{
          empId: 1032,
          empName: 'مريم',
          baseSalary: 2000,
          payrollMethod: 'monthly',
          employmentType: 'full_time',
        }],
      },
      { recordset: [] },
    ];

    const { postMonthlySalaryEntitlements } = await loadService();
    const result = await postMonthlySalaryEntitlements({ month: '2026-07', dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.status).toBe('new');
    expect(result.counts.inserted).toBe(1);
    expect(fakeCommit).not.toHaveBeenCalled();
  });

  it('apply inserts monthly_salary credit without cash move', async () => {
    poolQueryResults = [
      {
        recordset: [{
          empId: 1032,
          empName: 'مريم',
          baseSalary: 2000,
          payrollMethod: 'monthly',
          employmentType: 'full_time',
        }],
      },
      { recordset: [] },
    ];
    txQueryResults = [
      { recordset: [] },
      { recordset: [], rowsAffected: [1] },
    ];

    const { postMonthlySalaryEntitlements } = await loadService();
    const result = await postMonthlySalaryEntitlements({
      month: '2026-07',
      dryRun: false,
      createdByUserId: 1,
    });

    expect(result.dryRun).toBe(false);
    expect(result.counts.inserted).toBe(1);
    expect(fakeCommit).toHaveBeenCalled();
    expect(txQueryResults.length).toBeGreaterThan(0);
  });

  it('apply updates when amount differs', async () => {
    poolQueryResults = [
      {
        recordset: [{
          empId: 1032,
          empName: 'مريم',
          baseSalary: 2500,
          payrollMethod: 'monthly',
          employmentType: 'full_time',
        }],
      },
      {
        recordset: [{
          ID: 99,
          Amount: 2000,
          EntryDate: '2026-07-31',
          Notes: 'استحقاق راتب شهري عن شهر 2026-07',
        }],
      },
    ];
    txQueryResults = [
      {
        recordset: [{
          ID: 99,
          Amount: 2000,
          EntryDate: '2026-07-31',
          Notes: 'استحقاق راتب شهري عن شهر 2026-07',
        }],
      },
      { recordset: [], rowsAffected: [1] },
    ];

    const { postMonthlySalaryEntitlements } = await loadService();
    const result = await postMonthlySalaryEntitlements({ month: '2026-07', dryRun: false });

    expect(result.counts.updated).toBe(1);
    expect(result.rows[0]?.status).toBe('willUpdate');
  });

  it('apply counts alreadyPosted when unchanged', async () => {
    poolQueryResults = [
      {
        recordset: [{
          empId: 1032,
          empName: 'مريم',
          baseSalary: 2000,
          payrollMethod: 'monthly',
          employmentType: 'full_time',
        }],
      },
      {
        recordset: [{
          ID: 99,
          Amount: 2000,
          EntryDate: '2026-07-31',
          Notes: 'استحقاق راتب شهري عن شهر 2026-07',
        }],
      },
    ];
    txQueryResults = [
      {
        recordset: [{
          ID: 99,
          Amount: 2000,
          EntryDate: '2026-07-31',
          Notes: 'استحقاق راتب شهري عن شهر 2026-07',
        }],
      },
    ];

    const { postMonthlySalaryEntitlements } = await loadService();
    const result = await postMonthlySalaryEntitlements({ month: '2026-07', dryRun: false });

    expect(result.counts.alreadyPosted).toBe(1);
  });

  it('filters by empId when provided', async () => {
    poolQueryResults = [
      {
        recordset: [{
          empId: 1032,
          empName: 'مريم',
          baseSalary: 2000,
          payrollMethod: 'monthly',
          employmentType: 'full_time',
        }],
      },
      { recordset: [] },
    ];

    const { postMonthlySalaryEntitlements } = await loadService();
    const result = await postMonthlySalaryEntitlements({
      month: '2026-07',
      empId: 1032,
      dryRun: true,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.empId).toBe(1032);
  });
});

vi.mock('@/lib/api-auth', () => ({
  requirePageAccess: vi.fn(async () => ({
    ok: true,
    userId: 1,
    userName: 'Admin',
    userLevel: '1',
    roles: ['admin'],
    isSuperAdmin: false,
  })),
  isAuthResult: vi.fn().mockReturnValue(true),
}));

describe('monthly salary API route', () => {
  beforeEach(() => {
    resetMocks();
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
  });

  it('defaults to dryRun true', async () => {
    poolQueryResults = [{ recordset: [] }];
    const { POST } = await import('@/app/api/admin/hr/employee-ledger/monthly-salary/post/route');
    const res = await POST(
      new Request('http://localhost/api', {
        method: 'POST',
        body: JSON.stringify({ month: '2026-07' }),
      }) as unknown as import('next/server').NextRequest,
    );
    const data = await res.json();
    expect(data.dryRun).toBe(true);
    expect(fakeCommit).not.toHaveBeenCalled();
  });
});

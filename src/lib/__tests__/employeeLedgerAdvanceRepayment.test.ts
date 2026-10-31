import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

const originalFlag = process.env.EMP_LEDGER_DUAL_WRITE_ENABLED;

let fakeCommit = vi.fn();
let fakeRollback = vi.fn();
let txQueryResults: Array<{ recordset?: unknown[]; rowsAffected?: number[] }> = [];
let txQueryIdx = 0;
let fakeAllocateInvID = vi.fn();

function makeFakeDb(results: { recordset: unknown[] }[]) {
  let idx = 0;
  return {
    request: vi.fn(() => ({
      input: vi.fn().mockReturnThis(),
      query: vi.fn(async () => {
        const res = results[idx] ?? { recordset: [] };
        idx++;
        return res;
      }),
    })),
  };
}

vi.mock('@/platform/masterData/tenantScope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/masterData/tenantScope')>()),
  resolveLegacyBranchTenantId: vi.fn(async () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
}));

vi.mock('@/platform/masterData/financeCategories', () => ({
  ensureTenantFinanceCategory: vi.fn(async () => 9001),
}));

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => makeFakeDb([])),
  allocateInvID: vi.fn(async (...args: unknown[]) => fakeAllocateInvID(...args)),
  sql: {
    UniqueIdentifier: () => ({ type: 'uniqueidentifier' }),
    Int: () => ({ type: 'int' }),
    Date: () => ({ type: 'date' }),
    Decimal: () => ({ type: 'decimal' }),
    NVarChar: (n: unknown) => ({ type: 'nvarchar', length: n }),
    MAX: -1,
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
    ISOLATION_LEVEL: { SERIALIZABLE: 0 },
  },
}));

vi.mock('@/lib/employeeLedgerConfig', () => ({
  isEmployeeLedgerDualWriteEnabled: vi.fn(() => true),
}));

vi.mock('@/lib/services/employeeLedgerService', () => ({
  getEmployeeBranchBalance: vi.fn(),
}));

vi.mock('@/lib/businessDate', () => ({
  getCairoInvTimeDotStr: () => '12.00.00',
}));

import { getPool, allocateInvID } from '@/lib/db';
import { getEmployeeBranchBalance } from '@/lib/services/employeeLedgerService';
import {
  executeAdvanceRepayment,
  EmployeeLedgerAdvanceRepaymentError,
} from '@/lib/services/employeeLedgerAdvanceRepaymentService';
import { computePartnersAdvanceExcess } from '@/lib/hr/employee-withdrawal-buckets';

describe('executeAdvanceRepayment', () => {
  beforeEach(() => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    fakeCommit = vi.fn();
    fakeRollback = vi.fn();
    txQueryResults = [];
    txQueryIdx = 0;
    fakeAllocateInvID = vi.fn(async () => 555);
    vi.mocked(allocateInvID).mockImplementation(fakeAllocateInvID);
    vi.mocked(getEmployeeBranchBalance).mockReset();
  });

  afterEach(() => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = originalFlag;
  });

  it('rejects overpay beyond outstanding debt', async () => {
    vi.mocked(getPool).mockResolvedValue(
      makeFakeDb([
        { recordset: [{ EmpID: 12, EmpName: 'زياد' }] },
        { recordset: [{ PaymentID: 1 }] },
      ]) as never,
    );
    vi.mocked(getEmployeeBranchBalance).mockResolvedValue(-500);

    await expect(
      executeAdvanceRepayment({
        empId: 12,
        amount: 600,
        paymentMethodId: 1,
        date: '2026-10-31',
        branchId: 1,
        businessDayId: 10,
      }),
    ).rejects.toBeInstanceOf(EmployeeLedgerAdvanceRepaymentError);

    expect(fakeRollback).toHaveBeenCalled();
    expect(fakeCommit).not.toHaveBeenCalled();
  });

  it('posts cash-in + credit for partial repayment', async () => {
    vi.mocked(getPool).mockResolvedValue(
      makeFakeDb([
        { recordset: [{ EmpID: 12, EmpName: 'زياد' }] },
        { recordset: [{ PaymentID: 1 }] },
      ]) as never,
    );
    vi.mocked(getEmployeeBranchBalance).mockResolvedValue(-1000);
    // idempotency miss, cash insert, ledger insert
    txQueryResults = [
      { recordset: [] },
      { recordset: [{ ID: 7001 }] },
      { recordset: [{ ID: 8001 }] },
    ];

    const result = await executeAdvanceRepayment({
      empId: 12,
      amount: 400,
      paymentMethodId: 1,
      date: '2026-10-31',
      branchId: 1,
      businessDayId: 10,
      idempotencyKey: 'repay-test-partial-01',
    });

    expect(result.success).toBe(true);
    expect(result.cashMoveId).toBe(7001);
    expect(result.ledgerEntryId).toBe(8001);
    expect(result.amount).toBe(400);
    expect(result.outstandingDebtBefore).toBe(1000);
    expect(result.outstandingDebtAfter).toBe(600);
    expect(result.newBalance).toBe(-600);
    expect(fakeCommit).toHaveBeenCalled();
  });

  it('full repayment clears debt to zero', async () => {
    vi.mocked(getPool).mockResolvedValue(
      makeFakeDb([
        { recordset: [{ EmpID: 12, EmpName: 'زياد' }] },
        { recordset: [{ PaymentID: 1 }] },
      ]) as never,
    );
    vi.mocked(getEmployeeBranchBalance).mockResolvedValue(-250);
    txQueryResults = [
      { recordset: [] },
      { recordset: [{ ID: 7010 }] },
      { recordset: [{ ID: 8010 }] },
    ];

    const result = await executeAdvanceRepayment({
      empId: 12,
      amount: 250,
      paymentMethodId: 1,
      date: '2026-10-31',
      branchId: 3,
      businessDayId: 11,
      idempotencyKey: 'repay-test-full-01',
    });

    expect(result.outstandingDebtAfter).toBe(0);
    expect(result.newBalance).toBe(0);
  });
});

describe('partners advance excess with repayment', () => {
  it('repayment covers سلف without inflating استلم راتب', () => {
    const salaryAndTarget = 0;
    const params = {
      advanceDebits: 1000,
      payoutDebits: 0,
      salaryAndTarget,
      fundingCredits: 400, // advance_repayment folded into fundingCredits for partners
      settlementCredits: 0,
      settlementDebits: 0,
    };
    expect(salaryAndTarget).toBe(0);
    expect(computePartnersAdvanceExcess(params)).toBe(600);
  });

  it('full repayment + settlement leaves سلف 0', () => {
    expect(
      computePartnersAdvanceExcess({
        advanceDebits: 1780,
        payoutDebits: 0,
        salaryAndTarget: 0,
        fundingCredits: 0,
        settlementCredits: 1780,
      }),
    ).toBe(0);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = {
  getPool: vi.fn(async () => ({})),
  schemaOk: vi.fn(async () => true),
  withLock: vi.fn(),
  findCase: vi.fn(),
  upsertCase: vi.fn(),
  voidLedger: vi.fn(async () => 1),
};

vi.mock('@/lib/db', () => ({
  getPool: (...a: unknown[]) => m.getPool(...a),
  sql: { Int: 'Int' },
}));
vi.mock('../schema', () => ({
  isLateDeductionSchemaReady: (...a: unknown[]) => m.schemaOk(...a),
}));
vi.mock('../caseTransaction', () => ({
  withLateDeductionCaseLock: (...a: unknown[]) => m.withLock(...(a as [never, never])),
}));
vi.mock('../repository', () => ({
  findLateDeductionCase: (...a: unknown[]) => m.findCase(...a),
  upsertLateDeductionCase: (...a: unknown[]) => m.upsertCase(...a),
}));
vi.mock('../ledger', () => ({
  voidLateDeductionLedgerEntry: (...a: unknown[]) => m.voidLedger(...a),
}));

describe('voidLateDeductionForExcludedAttendance vs manager_applied', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.schemaOk.mockResolvedValue(true);
    m.upsertCase.mockResolvedValue({ caseId: 3, status: 'skipped' });
    m.withLock.mockImplementation(async (_k: unknown, cb: (db: unknown) => Promise<unknown>) => {
      const db = {
        request: () => {
          const chain: { input: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn> } = {
            input: vi.fn(),
            query: vi.fn(async () => ({ rowsAffected: [1] })),
          };
          chain.input.mockReturnValue(chain);
          return chain;
        },
      };
      return cb(db);
    });
  });

  it('voids manager_applied debit when attendance is corrected to absent', async () => {
    m.findCase.mockResolvedValue({
      caseId: 3,
      status: 'manager_applied',
      attendanceId: 88,
      ledgerEntryId: 99,
      dailyBasePay: 260,
      doNotAutoRecreate: false,
    });
    const { voidLateDeductionForExcludedAttendance } = await import(
      '../voidExcludedAttendance'
    );
    const result = await voidLateDeductionForExcludedAttendance({
      empId: 1,
      branchId: 10,
      workDate: '2026-11-08',
      attendanceId: 88,
      status: 'absent',
    });
    expect(result.voided).toBe(true);
    expect(result.reason).toBe('excluded_attendance_status');
    expect(m.voidLedger).toHaveBeenCalled();
    expect(m.upsertCase).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: 'skipped',
        amount: null,
        ledgerEntryId: null,
        lateMinutes: 0,
      }),
    );
  });
});

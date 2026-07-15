import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const lockTargetLedgerEntriesForRef = vi.fn();
const insertTargetLedgerEntry = vi.fn();
const updateTargetLedgerEntry = vi.fn();
const deleteTargetLedgerEntry = vi.fn();

vi.mock('@/lib/payroll/employee-target/employee-daily-target-ledger.repository', () => ({
  lockTargetLedgerEntriesForRef: (...a: unknown[]) => lockTargetLedgerEntriesForRef(...a),
  insertTargetLedgerEntry: (...a: unknown[]) => insertTargetLedgerEntry(...a),
  updateTargetLedgerEntry: (...a: unknown[]) => updateTargetLedgerEntry(...a),
  deleteTargetLedgerEntry: (...a: unknown[]) => deleteTargetLedgerEntry(...a),
  isUniqueConstraintError: (err: unknown) => {
    const n = (err as { number?: number })?.number;
    return n === 2627 || n === 2601;
  },
}));

import {
  syncEmployeeDailyTargetLedgerEntry,
  EmployeeDailyTargetLedgerConflictError,
} from '@/lib/payroll/employee-target/employee-daily-target-ledger-sync.service';
import {
  buildDailyTargetLedgerNote,
  payrollMonthFromWorkDate,
  EMP_LEDGER_REASON_TARGET,
} from '@/lib/payroll/employee-target/employee-daily-target-ledger.constants';
import { parseTargetLedgerSyncBody } from '@/lib/payroll/employee-target/employee-daily-target-ledger.schemas';

const tx = {} as never;

function baseEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 99,
    empId: 12,
    entryDate: '2026-07-15',
    entryDirection: 'credit',
    entryReason: 'target',
    amount: 100,
    payrollMonth: '2026-07',
    refType: 'TblEmpDailyTarget',
    refId: 25,
    cashMoveId: null,
    notes: buildDailyTargetLedgerNote('2026-07-15'),
    isVoided: false,
    createdByUserId: 1,
    createdAt: 'now',
    updatedAt: null,
    ...overrides,
  };
}

describe('daily target ledger helpers', () => {
  it('derives payroll month and Arabic notes; never uses commission', () => {
    expect(payrollMonthFromWorkDate('2026-07-15')).toBe('2026-07');
    expect(buildDailyTargetLedgerNote('2026-07-15')).toBe('استحقاق تارجت يومي بتاريخ 2026-07-15');
    expect(EMP_LEDGER_REASON_TARGET).toBe('target');
    expect(EMP_LEDGER_REASON_TARGET).not.toBe('commission');
  });

  it('parseTargetLedgerSyncBody defaults dryRun and rejects unlimited scope', () => {
    expect(parseTargetLedgerSyncBody({ workDate: '2026-07-15' }).dryRun).toBe(true);
    expect(() => parseTargetLedgerSyncBody({})).toThrow(/نطاق/);
    expect(() => parseTargetLedgerSyncBody({ year: 2026 })).toThrow(/month/);
  });
});

describe('syncEmployeeDailyTargetLedgerEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts credit target when amount > 0 and no entry', async () => {
    lockTargetLedgerEntriesForRef.mockResolvedValue([]);
    insertTargetLedgerEntry.mockResolvedValue(501);

    const r = await syncEmployeeDailyTargetLedgerEntry({
      dailyTarget: { id: 25, empId: 12, workDate: '2026-07-15', targetAmount: 100 },
      actorUserId: 7,
      transaction: tx,
    });

    expect(r.action).toBe('inserted');
    expect(r.ledgerEntryId).toBe(501);
    expect(insertTargetLedgerEntry).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        dailyTargetId: 25,
        amount: 100,
        empId: 12,
        workDate: '2026-07-15',
        actorUserId: 7,
      }),
    );
  });

  it('updates existing matching entry when amount changes', async () => {
    lockTargetLedgerEntriesForRef.mockResolvedValue([baseEntry({ amount: 100 })]);
    updateTargetLedgerEntry.mockResolvedValue(undefined);

    const r = await syncEmployeeDailyTargetLedgerEntry({
      dailyTarget: { id: 25, empId: 12, workDate: '2026-07-15', targetAmount: 60 },
      actorUserId: 7,
      transaction: tx,
    });

    expect(r.action).toBe('updated');
    expect(r.ledgerEntryId).toBe(99);
    expect(updateTargetLedgerEntry).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ ledgerEntryId: 99, amount: 60 }),
    );
    expect(insertTargetLedgerEntry).not.toHaveBeenCalled();
  });

  it('returns unchanged when fields already match', async () => {
    lockTargetLedgerEntriesForRef.mockResolvedValue([baseEntry()]);

    const r = await syncEmployeeDailyTargetLedgerEntry({
      dailyTarget: { id: 25, empId: 12, workDate: '2026-07-15', targetAmount: 100 },
      actorUserId: 7,
      transaction: tx,
    });

    expect(r.action).toBe('unchanged');
    expect(updateTargetLedgerEntry).not.toHaveBeenCalled();
    expect(insertTargetLedgerEntry).not.toHaveBeenCalled();
  });

  it('deletes entry when TargetAmount becomes 0', async () => {
    lockTargetLedgerEntriesForRef.mockResolvedValue([baseEntry()]);
    deleteTargetLedgerEntry.mockResolvedValue(undefined);

    const r = await syncEmployeeDailyTargetLedgerEntry({
      dailyTarget: { id: 25, empId: 12, workDate: '2026-07-15', targetAmount: 0 },
      actorUserId: 7,
      transaction: tx,
    });

    expect(r.action).toBe('deleted');
    expect(deleteTargetLedgerEntry).toHaveBeenCalledWith(tx, 99);
  });

  it('no-ops when TargetAmount is 0 and no entry', async () => {
    lockTargetLedgerEntriesForRef.mockResolvedValue([]);

    const r = await syncEmployeeDailyTargetLedgerEntry({
      dailyTarget: { id: 25, empId: 12, workDate: '2026-07-15', targetAmount: 0 },
      actorUserId: 7,
      transaction: tx,
    });

    expect(r.action).toBe('noop');
    expect(deleteTargetLedgerEntry).not.toHaveBeenCalled();
  });

  it('creates entry when TargetAmount goes from 0 to 80', async () => {
    lockTargetLedgerEntriesForRef.mockResolvedValue([]);
    insertTargetLedgerEntry.mockResolvedValue(777);

    const r = await syncEmployeeDailyTargetLedgerEntry({
      dailyTarget: { id: 25, empId: 12, workDate: '2026-07-15', targetAmount: 80 },
      actorUserId: 7,
      transaction: tx,
    });

    expect(r.action).toBe('inserted');
    expect(r.ledgerEntryId).toBe(777);
  });

  it('conflicts on wrong direction', async () => {
    lockTargetLedgerEntriesForRef.mockResolvedValue([
      baseEntry({ entryDirection: 'debit' }),
    ]);

    await expect(
      syncEmployeeDailyTargetLedgerEntry({
        dailyTarget: { id: 25, empId: 12, workDate: '2026-07-15', targetAmount: 100 },
        actorUserId: 7,
        transaction: tx,
      }),
    ).rejects.toBeInstanceOf(EmployeeDailyTargetLedgerConflictError);
  });

  it('conflicts on wrong employee', async () => {
    lockTargetLedgerEntriesForRef.mockResolvedValue([baseEntry({ empId: 99 })]);

    await expect(
      syncEmployeeDailyTargetLedgerEntry({
        dailyTarget: { id: 25, empId: 12, workDate: '2026-07-15', targetAmount: 100 },
        actorUserId: 7,
        transaction: tx,
      }),
    ).rejects.toBeInstanceOf(EmployeeDailyTargetLedgerConflictError);
  });

  it('conflicts on duplicate ledger rows', async () => {
    lockTargetLedgerEntriesForRef.mockResolvedValue([baseEntry({ id: 1 }), baseEntry({ id: 2 })]);

    await expect(
      syncEmployeeDailyTargetLedgerEntry({
        dailyTarget: { id: 25, empId: 12, workDate: '2026-07-15', targetAmount: 100 },
        actorUserId: 7,
        transaction: tx,
      }),
    ).rejects.toThrow(/تكرار/);
  });

  it('handles unique race by updating after re-lock', async () => {
    lockTargetLedgerEntriesForRef
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([baseEntry({ amount: 50 })]);
    insertTargetLedgerEntry.mockRejectedValue(Object.assign(new Error('dup'), { number: 2627 }));
    updateTargetLedgerEntry.mockResolvedValue(undefined);

    const r = await syncEmployeeDailyTargetLedgerEntry({
      dailyTarget: { id: 25, empId: 12, workDate: '2026-07-15', targetAmount: 100 },
      actorUserId: 7,
      transaction: tx,
    });

    expect(r.action).toBe('updated');
    expect(r.ledgerEntryId).toBe(99);
  });

  it('insert path keeps CashMoveID null via repository args (no cash move)', async () => {
    lockTargetLedgerEntriesForRef.mockResolvedValue([]);
    insertTargetLedgerEntry.mockResolvedValue(1);
    await syncEmployeeDailyTargetLedgerEntry({
      dailyTarget: { id: 25, empId: 12, workDate: '2026-07-15', targetAmount: 10 },
      actorUserId: null,
      transaction: tx,
    });
    // repository insert hardcodes CashMoveID NULL — sync never passes cashMoveId
    expect(insertTargetLedgerEntry.mock.calls[0][1]).not.toHaveProperty('cashMoveId');
  });
});

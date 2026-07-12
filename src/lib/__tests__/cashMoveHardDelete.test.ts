/**
 * Unit tests for cashMoveHardDeleteService — linked ledger cleanup before CashMove delete.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

type QueryHandler = (sqlText: string, inputs: Record<string, unknown>) => Promise<{
  recordset?: unknown[];
  rowsAffected?: number[];
}>;

function makeTx(handler: QueryHandler) {
  const executed: { sql: string; inputs: Record<string, unknown> }[] = [];

  class FakeRequest {
    private inputs: Record<string, unknown> = {};
    constructor(_tx?: unknown) {}
    input(name: string, _type: unknown, value: unknown) {
      this.inputs[name] = value;
      return this;
    }
    async query(sqlText: string) {
      executed.push({ sql: sqlText, inputs: { ...this.inputs } });
      return handler(sqlText, this.inputs);
    }
  }

  return {
    tx: {} as never,
    executed,
    install() {
      vi.doMock('@/lib/db', () => ({
        sql: {
          Request: FakeRequest,
          Int: (v?: unknown) => v,
        },
      }));
    },
  };
}

describe('cashMoveHardDeleteSuccessMessage', () => {
  it('returns ledger message when count > 0', async () => {
    const { cashMoveHardDeleteSuccessMessage } = await import(
      '@/lib/services/cashMoveHardDeleteService'
    );
    expect(cashMoveHardDeleteSuccessMessage(1)).toBe(
      'تم حذف الحركة وحذف تأثيرها من دفتر الموظفين.',
    );
  });

  it('returns plain success when count is 0', async () => {
    const { cashMoveHardDeleteSuccessMessage } = await import(
      '@/lib/services/cashMoveHardDeleteService'
    );
    expect(cashMoveHardDeleteSuccessMessage(0)).toBe('تم حذف الحركة بنجاح.');
  });
});

describe('deleteCashMoveWithLinkedLedgerEntries', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('deletes CashMove with no ledger rows (ledgerDeletedCount = 0)', async () => {
    const harness = makeTx(async (sqlText) => {
      if (sqlText.includes('FROM dbo.TblCashMove') && sqlText.includes('SELECT')) {
        return {
          recordset: [{
            ID: 100,
            invID: 1,
            invType: 'مصروفات',
            invDate: '2026-07-01',
            ExpINID: 5,
            GrandTolal: 50,
            PaymentMethodID: 1,
            inOut: 'out',
            Notes: null,
            ShiftMoveID: null,
          }],
        };
      }
      if (sqlText.includes('DELETE FROM dbo.TblEmpLedgerEntry')) {
        return { rowsAffected: [0] };
      }
      if (sqlText.includes('DELETE FROM dbo.TblCashMove')) {
        return { rowsAffected: [1] };
      }
      return { recordset: [], rowsAffected: [0] };
    });
    harness.install();

    const { deleteCashMoveWithLinkedLedgerEntries } = await import(
      '@/lib/services/cashMoveHardDeleteService'
    );
    const result = await deleteCashMoveWithLinkedLedgerEntries(harness.tx, 100);

    expect(result).toEqual({ deleted: true, ledgerDeletedCount: 0 });
    expect(harness.executed.some((e) => e.sql.includes('DELETE FROM dbo.TblEmpLedgerEntry'))).toBe(true);
    expect(harness.executed.some((e) => e.sql.includes('DELETE FROM dbo.TblCashMove'))).toBe(true);
  });

  it('deletes linked ledger rows then CashMove for employee advance', async () => {
    const harness = makeTx(async (sqlText) => {
      if (sqlText.includes('FROM dbo.TblCashMove') && sqlText.includes('SELECT')) {
        return {
          recordset: [{
            ID: 200,
            invID: 2,
            invType: 'مصروفات',
            invDate: '2026-07-01',
            ExpINID: 9,
            GrandTolal: 500,
            PaymentMethodID: 1,
            inOut: 'out',
            Notes: 'سلفة',
            ShiftMoveID: null,
          }],
        };
      }
      if (sqlText.includes('DELETE FROM dbo.TblEmpLedgerEntry')) {
        return { rowsAffected: [1] };
      }
      if (sqlText.includes('DELETE FROM dbo.TblCashMove')) {
        return { rowsAffected: [1] };
      }
      return { recordset: [], rowsAffected: [0] };
    });
    harness.install();

    const { deleteCashMoveWithLinkedLedgerEntries } = await import(
      '@/lib/services/cashMoveHardDeleteService'
    );
    const result = await deleteCashMoveWithLinkedLedgerEntries(harness.tx, 200);

    expect(result).toEqual({ deleted: true, ledgerDeletedCount: 1 });

    const ledgerDelete = harness.executed.find((e) => e.sql.includes('DELETE FROM dbo.TblEmpLedgerEntry'));
    const cashDelete = harness.executed.find((e) => e.sql.includes('DELETE FROM dbo.TblCashMove'));
    expect(ledgerDelete?.inputs.cashMoveId).toBe(200);
    expect(cashDelete?.inputs.cashMoveId).toBe(200);

    const ledgerIdx = harness.executed.findIndex((e) => e.sql.includes('DELETE FROM dbo.TblEmpLedgerEntry'));
    const cashIdx = harness.executed.findIndex((e) => e.sql.includes('DELETE FROM dbo.TblCashMove'));
    expect(ledgerIdx).toBeGreaterThanOrEqual(0);
    expect(cashIdx).toBeGreaterThan(ledgerIdx);
  });

  it('deletes linked payout ledger row then CashMove', async () => {
    const harness = makeTx(async (sqlText) => {
      if (sqlText.includes('FROM dbo.TblCashMove') && sqlText.includes('SELECT')) {
        return {
          recordset: [{
            ID: 300,
            invID: 3,
            invType: 'مصروفات',
            invDate: '2026-07-02',
            ExpINID: 12,
            GrandTolal: 1000,
            PaymentMethodID: 1,
            inOut: 'out',
            Notes: 'صرف مستحقات',
            ShiftMoveID: null,
          }],
        };
      }
      if (sqlText.includes('DELETE FROM dbo.TblEmpLedgerEntry')) {
        return { rowsAffected: [1] };
      }
      if (sqlText.includes('DELETE FROM dbo.TblCashMove')) {
        return { rowsAffected: [1] };
      }
      return { recordset: [], rowsAffected: [0] };
    });
    harness.install();

    const { deleteCashMoveWithLinkedLedgerEntries } = await import(
      '@/lib/services/cashMoveHardDeleteService'
    );
    const result = await deleteCashMoveWithLinkedLedgerEntries(harness.tx, 300);
    expect(result).toEqual({ deleted: true, ledgerDeletedCount: 1 });
  });

  it('deletes linked funding / advance repayment CashMove', async () => {
    const harness = makeTx(async (sqlText) => {
      if (sqlText.includes('FROM dbo.TblCashMove') && sqlText.includes('SELECT')) {
        return {
          recordset: [{
            ID: 400,
            invID: 4,
            invType: 'ايرادات',
            invDate: '2026-07-03',
            ExpINID: 20,
            GrandTolal: 250,
            PaymentMethodID: 1,
            inOut: 'in',
            Notes: 'تمويل موظف',
            ShiftMoveID: null,
          }],
        };
      }
      if (sqlText.includes('DELETE FROM dbo.TblEmpLedgerEntry')) {
        return { rowsAffected: [1] };
      }
      if (sqlText.includes('DELETE FROM dbo.TblCashMove')) {
        return { rowsAffected: [1] };
      }
      return { recordset: [], rowsAffected: [0] };
    });
    harness.install();

    const { deleteCashMoveWithLinkedLedgerEntries } = await import(
      '@/lib/services/cashMoveHardDeleteService'
    );
    const result = await deleteCashMoveWithLinkedLedgerEntries(harness.tx, 400);
    expect(result).toEqual({ deleted: true, ledgerDeletedCount: 1 });
    expect(harness.executed.find((e) => e.sql.includes('DELETE FROM dbo.TblEmpLedgerEntry'))?.inputs.cashMoveId).toBe(400);
  });

  it('returns not_found when CashMove does not exist', async () => {
    const harness = makeTx(async () => ({ recordset: [], rowsAffected: [0] }));
    harness.install();

    const { deleteCashMoveWithLinkedLedgerEntries } = await import(
      '@/lib/services/cashMoveHardDeleteService'
    );
    const result = await deleteCashMoveWithLinkedLedgerEntries(harness.tx, 999);
    expect(result).toEqual({ deleted: false, reason: 'not_found' });
    expect(harness.executed.some((e) => e.sql.includes('DELETE'))).toBe(false);
  });

  it('scopes ledger delete to the selected CashMoveID only', async () => {
    const harness = makeTx(async (sqlText) => {
      if (sqlText.includes('FROM dbo.TblCashMove') && sqlText.includes('SELECT')) {
        return {
          recordset: [{
            ID: 555,
            invID: 5,
            invType: 'مصروفات',
            invDate: '2026-07-04',
            ExpINID: 1,
            GrandTolal: 10,
            PaymentMethodID: 1,
            inOut: 'out',
            Notes: null,
            ShiftMoveID: null,
          }],
        };
      }
      if (sqlText.includes('DELETE FROM dbo.TblEmpLedgerEntry')) {
        expect(sqlText).toContain('WHERE CashMoveID = @cashMoveId');
        expect(sqlText).not.toContain('IS NULL');
        return { rowsAffected: [2] };
      }
      if (sqlText.includes('DELETE FROM dbo.TblCashMove')) {
        return { rowsAffected: [1] };
      }
      return { recordset: [], rowsAffected: [0] };
    });
    harness.install();

    const { deleteCashMoveWithLinkedLedgerEntries } = await import(
      '@/lib/services/cashMoveHardDeleteService'
    );
    await deleteCashMoveWithLinkedLedgerEntries(harness.tx, 555);

    const ledgerDelete = harness.executed.find((e) => e.sql.includes('DELETE FROM dbo.TblEmpLedgerEntry'));
    expect(ledgerDelete?.inputs.cashMoveId).toBe(555);
  });

  it('rolls back caller responsibility: throws Arabic error if CashMove delete fails after ledger delete', async () => {
    const harness = makeTx(async (sqlText) => {
      if (sqlText.includes('FROM dbo.TblCashMove') && sqlText.includes('SELECT')) {
        return {
          recordset: [{
            ID: 700,
            invID: 7,
            invType: 'مصروفات',
            invDate: '2026-07-05',
            ExpINID: 1,
            GrandTolal: 10,
            PaymentMethodID: 1,
            inOut: 'out',
            Notes: null,
            ShiftMoveID: null,
          }],
        };
      }
      if (sqlText.includes('DELETE FROM dbo.TblEmpLedgerEntry')) {
        return { rowsAffected: [1] };
      }
      if (sqlText.includes('DELETE FROM dbo.TblCashMove')) {
        throw new Error('The DELETE statement conflicted with the REFERENCE constraint');
      }
      return { recordset: [], rowsAffected: [0] };
    });
    harness.install();

    const { deleteCashMoveWithLinkedLedgerEntries, CashMoveHardDeleteError } = await import(
      '@/lib/services/cashMoveHardDeleteService'
    );

    await expect(deleteCashMoveWithLinkedLedgerEntries(harness.tx, 700)).rejects.toBeInstanceOf(
      CashMoveHardDeleteError,
    );
    await expect(deleteCashMoveWithLinkedLedgerEntries(harness.tx, 700)).rejects.toThrow(
      /فشل حذف حركة الخزنة/,
    );
  });
});

describe('deleteLedgerEntriesLinkedToCashMove', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not filter IsVoided so voided rows that block FK are also removed', async () => {
    const harness = makeTx(async (sqlText) => {
      expect(sqlText).toContain('DELETE FROM dbo.TblEmpLedgerEntry');
      expect(sqlText).toContain('WHERE CashMoveID = @cashMoveId');
      expect(sqlText).not.toMatch(/IsVoided/i);
      return { rowsAffected: [3] };
    });
    harness.install();

    const { deleteLedgerEntriesLinkedToCashMove } = await import(
      '@/lib/services/cashMoveHardDeleteService'
    );
    const count = await deleteLedgerEntriesLinkedToCashMove(harness.tx, 42);
    expect(count).toBe(3);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

type QueryResult = { recordset: Record<string, unknown>[]; rowsAffected?: number[] };

function createMockTx(handler: (sqlText: string) => QueryResult) {
  const api: {
    input: (...args: unknown[]) => typeof api;
    query: (sqlText: string) => Promise<QueryResult>;
  } = {
    input: () => api,
    query: async (sqlText: string) => handler(sqlText),
  };
  return {
    requestFactory: () => api,
  };
}

describe('closeTreasuryShift', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('closes the shift, saves recon with variance, and does not update TblNewDay', async () => {
    const queries: string[] = [];
    let shiftStatus = 1;
    const reconRows: Record<string, unknown>[] = [];

    const { requestFactory } = createMockTx((sqlText) => {
      queries.push(sqlText);
      if (sqlText.includes('FROM dbo.TblShiftMove sm') && sqlText.includes('INNER JOIN dbo.TblNewDay')) {
        return {
          recordset: [
            {
              ID: 42,
              UserID: 7,
              BranchID: 3,
              BusinessDayID: 99,
              Status: shiftStatus,
            },
          ],
        };
      }
      if (sqlText.includes('FROM dbo.TblTreasuryCloseRecon') && sqlText.includes('WHERE ShiftMoveID')) {
        return { recordset: reconRows.length ? [{ ID: 1 }] : [] };
      }
      if (sqlText.includes('INSERT INTO [dbo].[TblTreasuryCloseRecon]')) {
        reconRows.push({ id: 501 });
        return { recordset: [{ ID: 501 }] };
      }
      if (sqlText.includes('FROM [dbo].[TblPaymentMethods]')) {
        return { recordset: [{ PaymentMethod: 'نقدي' }] };
      }
      if (sqlText.includes('UPDATE dbo.TblShiftMove')) {
        shiftStatus = 0;
        return { recordset: [], rowsAffected: [1] };
      }
      if (sqlText.includes('UPDATE dbo.TblNewDay')) {
        throw new Error('must not close business day');
      }
      return { recordset: [] };
    });

    vi.doMock('@/lib/db', () => ({
      sql: {
        Int: 'Int',
        Date: 'Date',
        Decimal: () => 'Decimal',
        NVarChar: () => 'NVarChar',
        Request: class {
          constructor() {
            return requestFactory();
          }
        },
      },
      allocateInvID: vi.fn(),
    }));

    vi.doMock('@/modules/operations/clock/BusinessClock', () => ({
      now: () => new Date('2026-09-19T20:00:00+03:00'),
    }));

    vi.doMock('@/modules/operations/infra/shiftMoveRecord', () => ({
      formatLegacyEndTime: () => '8:00 PM',
    }));

    vi.doMock('@/modules/operations/infra/businessDayLock', () => ({
      lockOperationalWrite: vi.fn(),
    }));

    const { closeTreasuryShift } = await import('@/lib/actions/treasuryActions');
    const result = await closeTreasuryShift({} as never, {
      shiftMoveId: 42,
      branchId: 3,
      closedByUserId: 7,
      reconciliations: [
        {
          paymentMethodId: 1,
          systemAmount: 1000,
          countedAmount: 950,
          notes: undefined,
        },
      ],
    });

    expect(result.shiftMoveId).toBe(42);
    expect(result.businessDayId).toBe(99);
    expect(result.reconciliationIds).toEqual([501]);
    expect(result.variances[0]?.variance).toBe(-50);
    expect(result.variances[0]?.status).toBe('acceptable');
    expect(queries.some((q) => q.includes('UPDATE dbo.TblShiftMove'))).toBe(true);
    expect(queries.some((q) => q.includes('UPDATE dbo.TblNewDay'))).toBe(false);
    expect(shiftStatus).toBe(0);
  });

  it('rejects closing another user shift', async () => {
    const { requestFactory } = createMockTx((sqlText) => {
      if (sqlText.includes('FROM dbo.TblShiftMove sm')) {
        return {
          recordset: [
            {
              ID: 42,
              UserID: 99,
              BranchID: 3,
              BusinessDayID: 99,
              Status: 1,
            },
          ],
        };
      }
      return { recordset: [] };
    });

    vi.doMock('@/lib/db', () => ({
      sql: {
        Int: 'Int',
        Date: 'Date',
        Decimal: () => 'Decimal',
        NVarChar: () => 'NVarChar',
        Request: class {
          constructor() {
            return requestFactory();
          }
        },
      },
      allocateInvID: vi.fn(),
    }));
    vi.doMock('@/modules/operations/clock/BusinessClock', () => ({
      now: () => new Date(),
    }));
    vi.doMock('@/modules/operations/infra/shiftMoveRecord', () => ({
      formatLegacyEndTime: () => '8:00 PM',
    }));
    vi.doMock('@/modules/operations/infra/businessDayLock', () => ({
      lockOperationalWrite: vi.fn(),
    }));

    const { closeTreasuryShift } = await import('@/lib/actions/treasuryActions');
    await expect(
      closeTreasuryShift({} as never, {
        shiftMoveId: 42,
        branchId: 3,
        closedByUserId: 7,
        reconciliations: [],
      }),
    ).rejects.toThrow('يمكن تقفيل ورديتك فقط');
  });

  it('rejects duplicate shift reconciliation', async () => {
    const { requestFactory } = createMockTx((sqlText) => {
      if (sqlText.includes('FROM dbo.TblShiftMove sm')) {
        return {
          recordset: [
            {
              ID: 42,
              UserID: 7,
              BranchID: 3,
              BusinessDayID: 99,
              Status: 1,
            },
          ],
        };
      }
      if (sqlText.includes('FROM dbo.TblTreasuryCloseRecon')) {
        return { recordset: [{ ID: 1 }] };
      }
      return { recordset: [] };
    });

    vi.doMock('@/lib/db', () => ({
      sql: {
        Int: 'Int',
        Date: 'Date',
        Decimal: () => 'Decimal',
        NVarChar: () => 'NVarChar',
        Request: class {
          constructor() {
            return requestFactory();
          }
        },
      },
      allocateInvID: vi.fn(),
    }));
    vi.doMock('@/modules/operations/clock/BusinessClock', () => ({
      now: () => new Date(),
    }));
    vi.doMock('@/modules/operations/infra/shiftMoveRecord', () => ({
      formatLegacyEndTime: () => '8:00 PM',
    }));
    vi.doMock('@/modules/operations/infra/businessDayLock', () => ({
      lockOperationalWrite: vi.fn(),
    }));

    const { closeTreasuryShift } = await import('@/lib/actions/treasuryActions');
    await expect(
      closeTreasuryShift({} as never, {
        shiftMoveId: 42,
        branchId: 3,
        closedByUserId: 7,
        reconciliations: [
          { paymentMethodId: 1, systemAmount: 100, countedAmount: 100 },
        ],
      }),
    ).rejects.toThrow('تم تقفيل هذه الوردية مسبقاً');
  });
});

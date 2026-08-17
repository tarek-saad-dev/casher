import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

type QueryResult = { recordset: Array<Record<string, unknown>> };

let queryResults: QueryResult[] = [];

vi.mock('@/lib/db', () => ({
  sql: {
    Request: class FakeReq {
      input() {
        return this;
      }
      async query() {
        const next = queryResults.shift();
        return next ?? { recordset: [] };
      }
    },
    Int: (v?: unknown) => v,
    Date: (v?: unknown) => v,
    Decimal: () => ({}),
    NVarChar: () => ({}),
    MAX: -1,
  },
}));

describe('deductionSettlementPairing', () => {
  beforeEach(() => {
    queryResults = [];
  });

  it('returns null when expense is not an advance', async () => {
    queryResults = [{ recordset: [] }];
    const { findPairedDeductionSettlementId } = await import(
      '@/lib/actions/deductionSettlementPairing'
    );
    const id = await findPairedDeductionSettlementId({} as never, {
      ID: 10,
      BranchID: 1,
      invDate: '2026-08-16',
      ExpINID: 5,
      GrandTolal: 100,
      PaymentMethodID: 1,
      ShiftMoveID: 2,
    });
    expect(id).toBeNull();
  });

  it('returns paired settlement id when advance match exists', async () => {
    queryResults = [
      { recordset: [{ ok: 1 }] }, // is advance
      { recordset: [{ invTime: '10.15' }] }, // invTime
      { recordset: [{ ID: 11 }] }, // settlement
    ];
    const { findPairedDeductionSettlementId } = await import(
      '@/lib/actions/deductionSettlementPairing'
    );
    const id = await findPairedDeductionSettlementId({} as never, {
      ID: 10,
      BranchID: 1,
      invDate: '2026-08-16',
      ExpINID: 5,
      GrandTolal: 100,
      PaymentMethodID: 1,
      ShiftMoveID: 2,
    });
    expect(id).toBe(11);
  });
});

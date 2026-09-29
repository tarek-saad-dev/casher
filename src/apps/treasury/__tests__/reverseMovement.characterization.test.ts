import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Transaction } from 'mssql';
import type { ActorContext } from '@/platform/public';

const queries: string[] = [];

vi.mock('../internal/cashMoveInsert', () => ({
  insertCashMoveRow: vi.fn(async () => 202),
}));

vi.mock('../internal/idempotencyStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../internal/idempotencyStore')>();
  return {
    ...actual,
    findRegistryByKey: vi.fn(async () => null),
    insertRegistryRow: vi.fn(async () => undefined),
  };
});

vi.mock('../internal/treasuryOutbox', () => ({
  publishTreasuryOutboxEvent: vi.fn(async () => undefined),
}));

vi.mock('@/lib/db', () => ({
  sql: {
    Request: vi.fn(function Request() {
      return {
        input() { return this; },
        query: async (text: string) => {
          queries.push(text);
          if (text.includes('FROM dbo.TblCashMove') && text.includes('IsReversed')) {
            return {
              recordset: [{
                ID: 55,
                BranchID: 1,
                BusinessDayID: 10,
                ShiftMoveID: 5,
                GrandTolal: 80,
                inOut: 'in',
                invType: 'ايرادات',
                ExpINID: 3,
                PaymentMethodID: 2,
                Notes: 'funding',
                IsReversed: 0,
              }],
            };
          }
          return { recordset: [], rowsAffected: [1] };
        },
      };
    }),
    Int: 'Int',
    UniqueIdentifier: 'UniqueIdentifier',
    NVarChar: 'NVarChar',
  },
}));

const actor: ActorContext = {
  actorType: 'staff',
  actorId: '1',
  tenantId: '11111111-1111-1111-1111-111111111111',
  membershipId: null,
  viewLocationId: null,
};

const tx = {} as Transaction;

describe('reverseMoneyMovement characterization', () => {
  beforeEach(() => {
    queries.length = 0;
    vi.clearAllMocks();
  });

  it('posts one same-direction negative reversal and marks the original reversed', async () => {
    const { findRegistryByKey } = await import('../internal/idempotencyStore');
    const { insertCashMoveRow } = await import('../internal/cashMoveInsert');
    vi.mocked(findRegistryByKey)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        Id: 1,
        TenantId: actor.tenantId!,
        IdempotencyKey: 'income:abc',
        Fingerprint: 'fp',
        Kind: 'post',
        CashMoveId: 55,
        TransferGroupKey: null,
        OriginalIdempotencyKey: null,
        SourceRef: 'income:abc',
      });

    const { reverseMoneyMovement } = await import('../internal/reverseMovement');
    const id = await reverseMoneyMovement(tx, actor, {
      tenantId: actor.tenantId!,
      originalIdempotencyKey: 'income:abc',
      idempotencyKey: 'income:abc:reverse',
      reason: 'delete',
    });

    expect(id).toBe(202);
    expect(insertCashMoveRow).toHaveBeenCalledWith(tx, expect.objectContaining({
      direction: 'in',
      invType: 'income',
      amount: 80,
      negateAmount: true,
      reversalOfCashMoveId: 55,
    }));
    expect(queries.some((q) => q.includes('SET IsReversed = 1'))).toBe(true);
  });

  it('does not insert a second reversal when the original is already reversed', async () => {
    const { findRegistryByKey } = await import('../internal/idempotencyStore');
    const { insertCashMoveRow } = await import('../internal/cashMoveInsert');
    const { sql } = await import('@/lib/db');
    vi.mocked(findRegistryByKey)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        Id: 1,
        TenantId: actor.tenantId!,
        IdempotencyKey: 'income:abc',
        Fingerprint: 'fp',
        Kind: 'post',
        CashMoveId: 55,
        TransferGroupKey: null,
        OriginalIdempotencyKey: null,
        SourceRef: 'income:abc',
      });
    vi.mocked(sql.Request).mockImplementation(function Request() {
      return {
        input() { return this; },
        query: async (text: string) => {
          if (text.includes('ISNULL(IsReversed, 0)')) {
            return {
              recordset: [{
                ID: 55,
                BranchID: 1,
                BusinessDayID: 10,
                ShiftMoveID: 5,
                GrandTolal: 80,
                inOut: 'in',
                invType: 'ايرادات',
                ExpINID: 3,
                PaymentMethodID: 2,
                Notes: null,
                IsReversed: 1,
              }],
            };
          }
          if (text.includes('ReversalOfCashMoveId')) {
            return { recordset: [{ ID: 202 }] };
          }
          return { recordset: [] };
        },
      };
    } as never);

    const { reverseMoneyMovement } = await import('../internal/reverseMovement');
    const id = await reverseMoneyMovement(tx, actor, {
      tenantId: actor.tenantId!,
      originalIdempotencyKey: 'income:abc',
      idempotencyKey: 'income:abc:reverse-again',
      reason: 'delete',
    });
    expect(id).toBe(202);
    expect(insertCashMoveRow).not.toHaveBeenCalled();
  });
});

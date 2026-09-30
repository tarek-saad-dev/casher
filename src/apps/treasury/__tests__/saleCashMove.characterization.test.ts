import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Transaction } from 'mssql';
import type { ActorContext } from '@/platform/public';
import { postSaleCashMove } from '../internal/postSaleCashMove';
import { TreasuryIdempotencyConflictError } from '../internal/idempotencyStore';
import { fingerprintSalePost } from '../internal/saleCommandFingerprint';

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
    MAX: -1,
    Request: class MockRequest {
      input() {
        return this;
      }
      async query() {
        return { recordset: [{ ID: 501 }] };
      }
    },
    Int: 'Int',
    Date: 'Date',
    NVarChar: vi.fn((len?: number) => `NVarChar(${len})`),
    Decimal: vi.fn(() => 'Decimal'),
    UniqueIdentifier: 'UniqueIdentifier',
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

const baseCommand = {
  tenantId: actor.tenantId!,
  saleInvId: 9001,
  invType: 'مبيعات' as const,
  invDate: '2026-09-30',
  invTime: '14.30',
  clientId: 42,
  amount: 150,
  inOut: 'in' as const,
  notes: 'مبيعات',
  shiftMoveId: 7,
  paymentMethodId: 2,
  branchId: 1,
  businessDayId: 10,
  sourceRef: 'pos-sale:9001',
  idempotencyKey: 'pos-sale:مبيعات:9001',
};

describe('Treasury sale CashMove posting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts sale shape using the sale invoice invID', async () => {
    const id = await postSaleCashMove(tx, actor, baseCommand);
    expect(id).toBe(501);
  });

  it('replays same idempotency key without second insert', async () => {
    const { findRegistryByKey, insertRegistryRow } = await import('../internal/idempotencyStore');
    const fp = fingerprintSalePost(baseCommand);
    vi.mocked(findRegistryByKey).mockResolvedValueOnce({
      Id: 1,
      TenantId: actor.tenantId!,
      IdempotencyKey: baseCommand.idempotencyKey,
      Fingerprint: fp,
      Kind: 'sale',
      CashMoveId: 88,
      TransferGroupKey: null,
      OriginalIdempotencyKey: null,
      SourceRef: baseCommand.sourceRef,
    });

    const id = await postSaleCashMove(tx, actor, baseCommand);
    expect(id).toBe(88);
    expect(insertRegistryRow).not.toHaveBeenCalled();
  });

  it('conflicts when same idempotency key has different fingerprint', async () => {
    const { findRegistryByKey } = await import('../internal/idempotencyStore');
    vi.mocked(findRegistryByKey).mockResolvedValueOnce({
      Id: 1,
      TenantId: actor.tenantId!,
      IdempotencyKey: baseCommand.idempotencyKey,
      Fingerprint: 'different',
      Kind: 'sale',
      CashMoveId: 88,
      TransferGroupKey: null,
      OriginalIdempotencyKey: null,
      SourceRef: null,
    });

    await expect(
      postSaleCashMove(tx, actor, { ...baseCommand, amount: 999 }),
    ).rejects.toBeInstanceOf(TreasuryIdempotencyConflictError);
  });

  it('preserves sourceRef in registry row', async () => {
    const { insertRegistryRow } = await import('../internal/idempotencyStore');
    await postSaleCashMove(tx, actor, baseCommand);
    expect(insertRegistryRow).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        kind: 'sale',
        sourceRef: 'pos-sale:9001',
      }),
    );
  });
});

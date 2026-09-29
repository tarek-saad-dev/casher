import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Transaction } from 'mssql';
import type { ActorContext } from '@/platform/public';
import { createLegacyMoneyMovementAdapter } from '../public';
import { TreasuryIdempotencyConflictError } from '../internal/idempotencyStore';

vi.mock('../internal/cashMoveInsert', () => ({
  insertCashMoveRow: vi.fn(async () => 101),
}));

vi.mock('../internal/idempotencyStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../internal/idempotencyStore')>();
  return {
    ...actual,
    findRegistryByKey: vi.fn(async () => null),
    insertRegistryRow: vi.fn(async () => undefined),
    findRegistryRowsByTransferGroup: vi.fn(async () => []),
  };
});

vi.mock('../internal/treasuryOutbox', () => ({
  publishTreasuryOutboxEvent: vi.fn(async () => undefined),
}));

vi.mock('@/lib/db', () => ({
  sql: {
    Request: vi.fn().mockImplementation(() => ({
      input: vi.fn().mockReturnThis(),
      query: vi.fn(async () => ({ recordset: [] })),
    })),
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

describe('MoneyMovement port characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects sale and sale_split while InsCashMoveSales is live', async () => {
    const port = createLegacyMoneyMovementAdapter();
    await expect(
      port.post(tx, actor, {
        tenantId: actor.tenantId!,
        locationId: 1,
        businessDayId: 10,
        shiftInstanceId: 5,
        amount: 100,
        direction: 'in',
        reason: 'sale',
        sourceRef: 'sale:1',
        paymentMethodId: 1,
        idempotencyKey: 'sale:1',
      }),
    ).rejects.toThrow(/InsCashMoveSales/);

    await expect(
      port.post(tx, actor, {
        tenantId: actor.tenantId!,
        locationId: 1,
        businessDayId: 10,
        shiftInstanceId: 5,
        amount: 100,
        direction: 'in',
        reason: 'sale_split',
        sourceRef: 'sale:1',
        paymentMethodId: 1,
        idempotencyKey: 'sale:1',
      }),
    ).rejects.toThrow(/InsCashMoveSales/);
  });

  it('posts non-sale income through treasury insert helper', async () => {
    const { insertCashMoveRow } = await import('../internal/cashMoveInsert');
    const port = createLegacyMoneyMovementAdapter();
    const id = await port.post(tx, actor, {
      tenantId: actor.tenantId!,
      locationId: 1,
      businessDayId: 10,
      shiftInstanceId: 5,
      amount: 50,
      direction: 'in',
      reason: 'income',
      invType: 'income',
      sourceRef: 'income:abc',
      paymentMethodId: 2,
      categoryId: 3,
      idempotencyKey: 'income:abc',
    });
    expect(id).toBe(101);
    expect(insertCashMoveRow).toHaveBeenCalledTimes(1);
  });

  it('replays same idempotency key without second insert', async () => {
    const { findRegistryByKey } = await import('../internal/idempotencyStore');
    const { insertCashMoveRow } = await import('../internal/cashMoveInsert');
    const { fingerprintPost } = await import('../internal/commandFingerprint');

    const command = {
      tenantId: actor.tenantId!,
      locationId: 1,
      businessDayId: 10,
      shiftInstanceId: 5,
      amount: 50,
      direction: 'in' as const,
      reason: 'income',
      sourceRef: 'income:abc',
      paymentMethodId: 2,
      idempotencyKey: 'income:abc',
    };
    const fp = fingerprintPost(command);

    vi.mocked(findRegistryByKey).mockResolvedValueOnce({
      Id: 1,
      TenantId: actor.tenantId!,
      IdempotencyKey: 'income:abc',
      Fingerprint: fp,
      Kind: 'post',
      CashMoveId: 55,
      TransferGroupKey: null,
      OriginalIdempotencyKey: null,
      SourceRef: 'income:abc',
    });

    const port = createLegacyMoneyMovementAdapter();
    const id = await port.post(tx, actor, command);
    expect(id).toBe(55);
    expect(insertCashMoveRow).not.toHaveBeenCalled();
  });

  it('conflicts when same idempotency key has different fingerprint', async () => {
    const { findRegistryByKey } = await import('../internal/idempotencyStore');
    vi.mocked(findRegistryByKey).mockResolvedValueOnce({
      Id: 1,
      TenantId: actor.tenantId!,
      IdempotencyKey: 'income:abc',
      Fingerprint: 'different',
      Kind: 'post',
      CashMoveId: 55,
      TransferGroupKey: null,
      OriginalIdempotencyKey: null,
      SourceRef: null,
    });

    const port = createLegacyMoneyMovementAdapter();
    await expect(
      port.post(tx, actor, {
        tenantId: actor.tenantId!,
        locationId: 1,
        businessDayId: 10,
        shiftInstanceId: 5,
        amount: 99,
        direction: 'in',
        reason: 'income',
        sourceRef: 'income:abc',
        paymentMethodId: 2,
        idempotencyKey: 'income:abc',
      }),
    ).rejects.toBeInstanceOf(TreasuryIdempotencyConflictError);
  });
});

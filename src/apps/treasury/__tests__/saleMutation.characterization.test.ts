import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Transaction } from 'mssql';
import type { ActorContext } from '@/platform/public';
import { replaceSaleCashMove } from '../internal/replaceSaleCashMove';
import { removeSaleCashMove } from '../internal/removeSaleCashMove';
import { TreasuryIdempotencyConflictError } from '../internal/idempotencyStore';

const mocks = vi.hoisted(() => ({
  findRegistryByKey: vi.fn(),
  updateRegistryRow: vi.fn(),
  deleteRegistryByKey: vi.fn(),
  insertSaleCashMoveRow: vi.fn(),
  postSaleCashMove: vi.fn(),
  reverseMoneyMovement: vi.fn(),
  publish: vi.fn(),
}));

vi.mock('../internal/idempotencyStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../internal/idempotencyStore')>();
  return {
    ...actual,
    findRegistryByKey: mocks.findRegistryByKey,
    updateRegistryRow: mocks.updateRegistryRow,
    deleteRegistryByKey: mocks.deleteRegistryByKey,
  };
});

vi.mock('../internal/insertSaleCashMoveRow', () => ({
  insertSaleCashMoveRow: mocks.insertSaleCashMoveRow,
}));

vi.mock('../internal/postSaleCashMove', () => ({
  postSaleCashMove: mocks.postSaleCashMove,
}));

vi.mock('../internal/reverseMovement', () => ({
  reverseMoneyMovement: mocks.reverseMoneyMovement,
}));

vi.mock('../internal/treasuryOutbox', () => ({
  publishTreasuryOutboxEvent: mocks.publish,
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

describe('DRVO-010 sale mutation characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findRegistryByKey.mockResolvedValue(null);
    mocks.postSaleCashMove.mockResolvedValue(501);
    mocks.insertSaleCashMoveRow.mockResolvedValue(502);
    mocks.reverseMoneyMovement.mockResolvedValue(503);
    mocks.deleteRegistryByKey.mockResolvedValue(true);
  });

  it('replace posts through postSaleCashMove when no registry exists', async () => {
    const id = await replaceSaleCashMove(tx, actor, baseCommand);
    expect(id).toBe(501);
    expect(mocks.postSaleCashMove).toHaveBeenCalledOnce();
    expect(mocks.reverseMoneyMovement).not.toHaveBeenCalled();
  });

  it('replace returns existing CashMoveId on fingerprint replay', async () => {
    mocks.findRegistryByKey.mockResolvedValue({
      CashMoveId: 777,
      Fingerprint: 'abc',
    });
    const { fingerprintSalePost } = await import('../internal/saleCommandFingerprint');
    const fp = fingerprintSalePost(baseCommand);
    mocks.findRegistryByKey.mockResolvedValue({
      CashMoveId: 777,
      Fingerprint: fp,
    });

    const id = await replaceSaleCashMove(tx, actor, baseCommand);
    expect(id).toBe(777);
    expect(mocks.reverseMoneyMovement).not.toHaveBeenCalled();
    expect(mocks.insertSaleCashMoveRow).not.toHaveBeenCalled();
  });

  it('replace reverses, inserts, and updates registry when fingerprint changes', async () => {
    mocks.findRegistryByKey.mockResolvedValue({
      CashMoveId: 600,
      Fingerprint: 'stale-fingerprint',
    });

    const id = await replaceSaleCashMove(tx, actor, { ...baseCommand, amount: 200 });
    expect(id).toBe(502);
    expect(mocks.reverseMoneyMovement).toHaveBeenCalledOnce();
    expect(mocks.insertSaleCashMoveRow).toHaveBeenCalledOnce();
    expect(mocks.updateRegistryRow).toHaveBeenCalledOnce();
    const { saleReplaceReverseIdempotencyKey, saleReplacedOutboxIdempotencyKey } = await import(
      '../internal/saleCommandFingerprint'
    );
    expect(mocks.reverseMoneyMovement.mock.calls[0]?.[2]).toMatchObject({
      idempotencyKey: saleReplaceReverseIdempotencyKey(baseCommand.saleInvId, 'مبيعات', 600),
      reason: 'sale_replace',
    });
    expect(mocks.publish.mock.calls[0]?.[2]).toBe('treasury.sale.replaced');
    expect(mocks.publish.mock.calls[0]?.[4]).toBe(
      saleReplacedOutboxIdempotencyKey(baseCommand.idempotencyKey, 600),
    );
  });

  it('a second replace uses the new live movement for reversal and outbox keys', async () => {
    const { saleReplaceReverseIdempotencyKey, saleReplacedOutboxIdempotencyKey } = await import(
      '../internal/saleCommandFingerprint'
    );
    mocks.findRegistryByKey.mockResolvedValueOnce({
      CashMoveId: 600,
      Fingerprint: 'stale-fingerprint',
    });
    await replaceSaleCashMove(tx, actor, { ...baseCommand, amount: 200 });

    mocks.findRegistryByKey.mockResolvedValueOnce({
      CashMoveId: 502,
      Fingerprint: 'still-stale',
    });
    mocks.insertSaleCashMoveRow.mockResolvedValueOnce(700);
    const second = await replaceSaleCashMove(tx, actor, { ...baseCommand, amount: 250 });
    expect(second).toBe(700);

    const firstReverse = mocks.reverseMoneyMovement.mock.calls[0]?.[2].idempotencyKey;
    const secondReverse = mocks.reverseMoneyMovement.mock.calls[1]?.[2].idempotencyKey;
    expect(firstReverse).toBe(saleReplaceReverseIdempotencyKey(baseCommand.saleInvId, 'مبيعات', 600));
    expect(secondReverse).toBe(saleReplaceReverseIdempotencyKey(baseCommand.saleInvId, 'مبيعات', 502));
    expect(firstReverse).not.toBe(secondReverse);

    const firstOutbox = mocks.publish.mock.calls[0]?.[4];
    const secondOutbox = mocks.publish.mock.calls[1]?.[4];
    expect(firstOutbox).toBe(saleReplacedOutboxIdempotencyKey(baseCommand.idempotencyKey, 600));
    expect(secondOutbox).toBe(saleReplacedOutboxIdempotencyKey(baseCommand.idempotencyKey, 502));
    expect(firstOutbox).not.toBe(secondOutbox);
  });

  it('replay of the same replacement does not reverse or publish again', async () => {
    const { fingerprintSalePost } = await import('../internal/saleCommandFingerprint');
    const changed = { ...baseCommand, amount: 200 };
    mocks.findRegistryByKey.mockResolvedValueOnce({
      CashMoveId: 600,
      Fingerprint: 'stale-fingerprint',
    });
    await replaceSaleCashMove(tx, actor, changed);

    mocks.findRegistryByKey.mockResolvedValueOnce({
      CashMoveId: 502,
      Fingerprint: fingerprintSalePost(changed),
    });
    const replayed = await replaceSaleCashMove(tx, actor, changed);
    expect(replayed).toBe(502);
    expect(mocks.reverseMoneyMovement).toHaveBeenCalledOnce();
    expect(mocks.publish).toHaveBeenCalledOnce();
    expect(mocks.insertSaleCashMoveRow).toHaveBeenCalledOnce();
  });

  it('replace zero-total reverses the current movement and deletes registry', async () => {
    const { saleReplaceReverseIdempotencyKey } = await import('../internal/saleCommandFingerprint');
    mocks.findRegistryByKey.mockResolvedValue({
      CashMoveId: 600,
      Fingerprint: 'old',
    });

    const id = await replaceSaleCashMove(tx, actor, { ...baseCommand, amount: 0 });
    expect(id).toBeNull();
    expect(mocks.reverseMoneyMovement).toHaveBeenCalledOnce();
    expect(mocks.reverseMoneyMovement.mock.calls[0]?.[2]).toMatchObject({
      idempotencyKey: saleReplaceReverseIdempotencyKey(baseCommand.saleInvId, 'مبيعات', 600),
      reason: 'sale_replace_zero',
    });
    expect(mocks.deleteRegistryByKey).toHaveBeenCalledOnce();
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('replace with no registry posts through a cash-move-scoped outbox prefix', async () => {
    const { saleReplacePostOutboxKeyPrefix } = await import('../internal/saleCommandFingerprint');
    await replaceSaleCashMove(tx, actor, baseCommand);
    expect(mocks.postSaleCashMove).toHaveBeenCalledWith(tx, actor, baseCommand, {
      outboxKeyPrefix: saleReplacePostOutboxKeyPrefix(baseCommand.idempotencyKey),
    });
  });

  it('remove returns treasuryOwned=false when no registry', async () => {
    const result = await removeSaleCashMove(tx, actor, {
      tenantId: baseCommand.tenantId,
      saleInvId: baseCommand.saleInvId,
      invType: 'مبيعات',
    });
    expect(result.treasuryOwned).toBe(false);
    expect(mocks.reverseMoneyMovement).not.toHaveBeenCalled();
  });

  it('remove reverses and deletes registry for treasury-owned sale', async () => {
    mocks.findRegistryByKey.mockResolvedValue({
      CashMoveId: 600,
      Fingerprint: 'fp',
    });

    const result = await removeSaleCashMove(tx, actor, {
      tenantId: baseCommand.tenantId,
      saleInvId: baseCommand.saleInvId,
      invType: 'مبيعات',
    });
    expect(result.treasuryOwned).toBe(true);
    expect(result.reversedCashMoveId).toBe(503);
    expect(mocks.reverseMoneyMovement).toHaveBeenCalledOnce();
    expect(mocks.deleteRegistryByKey).toHaveBeenCalledOnce();
  });

  it('replace propagates TreasuryIdempotencyConflictError from postSaleCashMove', async () => {
    mocks.postSaleCashMove.mockRejectedValue(new TreasuryIdempotencyConflictError());
    await expect(replaceSaleCashMove(tx, actor, baseCommand)).rejects.toBeInstanceOf(
      TreasuryIdempotencyConflictError,
    );
  });
});

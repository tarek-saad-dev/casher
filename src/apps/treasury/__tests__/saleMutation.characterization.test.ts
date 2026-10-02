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
  });

  it('replace zero-total reverses and deletes registry', async () => {
    mocks.findRegistryByKey.mockResolvedValue({
      CashMoveId: 600,
      Fingerprint: 'old',
    });

    const id = await replaceSaleCashMove(tx, actor, { ...baseCommand, amount: 0 });
    expect(id).toBeNull();
    expect(mocks.reverseMoneyMovement).toHaveBeenCalledOnce();
    expect(mocks.deleteRegistryByKey).toHaveBeenCalledOnce();
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

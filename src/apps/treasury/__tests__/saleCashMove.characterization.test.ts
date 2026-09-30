import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Transaction } from 'mssql';
import type { ActorContext } from '@/platform/public';
import {
  insertSaleCashMoveResolvingConflict,
  postSaleCashMove,
} from '../internal/postSaleCashMove';
import { TreasuryIdempotencyConflictError } from '../internal/idempotencyStore';
import { fingerprintSalePost } from '../internal/saleCommandFingerprint';

const sqlState = vi.hoisted(() => ({
  queries: [] as string[],
  inputBatches: [] as Array<Record<string, unknown>>,
  nextResult: (): { recordset: Array<Record<string, unknown>> } => ({
    recordset: [{ Outcome: 'inserted', CashMoveId: 501, ExistingFingerprint: null }],
  }),
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
    MAX: -1,
    Request: class MockRequest {
      private inputs: Record<string, unknown> = {};
      input(name: string, _type: unknown, value: unknown) {
        this.inputs[name] = value;
        return this;
      }
      async query(text: string) {
        sqlState.queries.push(text);
        sqlState.inputBatches.push({ ...this.inputs });
        return sqlState.nextResult();
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

function replayRow(cashMoveId: number, fingerprint: string) {
  return {
    recordset: [{ Outcome: 'replay', CashMoveId: cashMoveId, ExistingFingerprint: fingerprint }],
  };
}

describe('Treasury sale CashMove posting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlState.queries.length = 0;
    sqlState.inputBatches.length = 0;
    sqlState.nextResult = () => ({
      recordset: [{ Outcome: 'inserted', CashMoveId: 501, ExistingFingerprint: null }],
    });
  });

  it('posts sale shape using the sale invoice invID', async () => {
    const { publishTreasuryOutboxEvent } = await import('../internal/treasuryOutbox');
    const id = await postSaleCashMove(tx, actor, baseCommand);
    expect(id).toBe(501);
    expect(sqlState.queries[0]).toContain('SAVE TRANSACTION drvo_sale_post');
    expect(sqlState.queries[0]).toContain('ROLLBACK TRANSACTION drvo_sale_post');
    expect(sqlState.queries[0]).toContain('ERROR_NUMBER() IN (2601, 2627)');
    expect(sqlState.inputBatches[0]).toMatchObject({
      invID: baseCommand.saleInvId,
      sourceRef: baseCommand.sourceRef,
      key: baseCommand.idempotencyKey,
    });
    expect(publishTreasuryOutboxEvent).toHaveBeenCalledOnce();
  });

  it('replays same idempotency key without second insert', async () => {
    const { findRegistryByKey } = await import('../internal/idempotencyStore');
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
    expect(sqlState.queries).toHaveLength(0);
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
    await postSaleCashMove(tx, actor, baseCommand);
    expect(sqlState.queries[0]).toContain('TreasuryMovementRegistry');
    expect(sqlState.queries[0]).toContain("N'sale'");
    expect(sqlState.inputBatches[0]?.sourceRef).toBe('pos-sale:9001');
  });

  it('rolls back the new CashMove when registry insert hits a unique conflict', async () => {
    const { publishTreasuryOutboxEvent } = await import('../internal/treasuryOutbox');
    const fp = fingerprintSalePost(baseCommand);
    sqlState.nextResult = () => replayRow(88, fp);

    const id = await insertSaleCashMoveResolvingConflict(tx, baseCommand);
    expect(id).toBe(88);
    expect(sqlState.queries).toHaveLength(1);
    expect(sqlState.queries[0]).toContain('ROLLBACK TRANSACTION drvo_sale_post');
    expect(publishTreasuryOutboxEvent).not.toHaveBeenCalled();
  });

  it('rejects a conflicting replay whose fingerprint does not match', async () => {
    const { publishTreasuryOutboxEvent } = await import('../internal/treasuryOutbox');
    sqlState.nextResult = () => replayRow(88, 'different');

    await expect(insertSaleCashMoveResolvingConflict(tx, baseCommand)).rejects.toBeInstanceOf(
      TreasuryIdempotencyConflictError,
    );
    expect(publishTreasuryOutboxEvent).not.toHaveBeenCalled();
  });

  it('returns the existing CashMoveId for a same-command replay after the insert path', async () => {
    const fp = fingerprintSalePost(baseCommand);
    sqlState.nextResult = () => replayRow(88, fp);
    const id = await postSaleCashMove(tx, actor, baseCommand);
    expect(id).toBe(88);
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  recordset: [] as Array<{ ProID: number; SPrice1: number; Bonus: number; isDeleted: number }>,
  query: '',
  bound: {} as Record<string, unknown>,
}));
vi.mock('@/lib/db', () => ({
  sql: {
    Int: 'INT',
    UniqueIdentifier: 'UUID',
    Request: class {
      input(name: string, _kind: unknown, value: unknown) {
        mocks.bound[name] = value;
        return this;
      }
      async query(text: string) {
        mocks.query = text;
        return { recordset: mocks.recordset };
      }
    },
  },
}));
import { assertReferralCheckoutCatalogPrices } from '@/lib/referrals/referralCatalogPriceGuard';
import { ReferralCheckoutError } from '@/lib/referrals/referralCheckoutPolicy';

const tenantId = '01234567-89ab-4cde-8fab-0123456789ab';
const db = {} as import('mssql').Transaction;
const item = { proId: 9, sPrice: 200, bonus: 10, qty: 1 };
beforeEach(() => {
  mocks.query = '';
  mocks.bound = {};
  mocks.recordset = [{ ProID: 9, SPrice1: 200, Bonus: 10, isDeleted: 0 }];
});

describe('tenant catalog pricing in the atomic referral sale', () => {
  it('requires official catalog price and line commission for the session tenant', async () => {
    await expect(assertReferralCheckoutCatalogPrices(db, tenantId, [item])).resolves.toBeUndefined();
    expect(mocks.query).toContain('TenantId = @tenantId');
    expect(mocks.query).toContain('ProID IN (@proId0)');
    expect(mocks.bound).toMatchObject({ tenantId, proId0: 9 });
  });

  it('rejects discount abuse via tampered custom price', async () => {
    await expect(assertReferralCheckoutCatalogPrices(db, tenantId, [{ ...item, sPrice: 1 }]))
      .rejects.toThrowError(expect.objectContaining({ code: 'REFERRAL_DISCOUNT_CONFLICT' }));
  });

  it('rejects tampered employee bonus or duplicate sale with mismatched bonus', async () => {
    await expect(assertReferralCheckoutCatalogPrices(db, tenantId, [{ ...item, bonus: 200 }]))
      .rejects.toThrowError(expect.objectContaining({ code: 'REFERRAL_DISCOUNT_CONFLICT' }));
  });

  it('rejects foreign, deleted, and unavailable service rows', async () => {
    for (const rows of [
      [], [{ ProID: 9, SPrice1: 200, Bonus: 10, isDeleted: 1 }],
      [{ ProID: 9, SPrice1: 0, Bonus: 10, isDeleted: 0 }],
    ]) {
      mocks.recordset = rows;
      await expect(assertReferralCheckoutCatalogPrices(db, tenantId, [item]))
        .rejects.toBeInstanceOf(ReferralCheckoutError);
    }
  });

  it('rejects zero/negative/fractional amounts and invalid IDs before DB access', async () => {
    for (const val of [
      { ...item, proId: -1 },
      { ...item, sPrice: 0 },
      { ...item, qty: 0 },
      { ...item, qty: 1.5 },
      { ...item, bonus: -1 },
      { ...item, sPrice: Number.NaN },
      { ...item, sPrice: 1.001 },
    ]) {
      mocks.query = '';
      await expect(assertReferralCheckoutCatalogPrices(db, tenantId, [val])).rejects.toBeInstanceOf(ReferralCheckoutError);
      expect(mocks.query).toBe('');
    }
  });

  it('checks each service ID but rejects any client price outside current tenant catalog', async () => {
    mocks.recordset = [{ ProID: 9, SPrice1: 200, Bonus: 10, isDeleted: 0 }];
    await expect(assertReferralCheckoutCatalogPrices(db, tenantId,
      [item, { proId: 10, sPrice: 300, qty: 1, bonus: 0 }]))
      .rejects.toThrowError(expect.objectContaining({ code: 'REFERRAL_DISCOUNT_CONFLICT' }));
    expect(mocks.query).toContain('@proId1');
  });
});

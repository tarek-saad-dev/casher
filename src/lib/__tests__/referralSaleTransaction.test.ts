import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: Record<string, unknown> }>,
  results: [] as Array<{ recordset: Record<string, unknown>[]; rowsAffected?: number[] }>,
  failContaining: null as string | null,
}));
vi.mock('@/lib/db', () => ({
  sql: {
    Int: 'INT', BigInt: 'BIGINT', UniqueIdentifier: 'UUID',
    Decimal: () => 'DECIMAL',
    NVarChar: () => 'NVARCHAR',
    Request: class FakeRequest {
      params: Record<string, unknown> = {};
      input(name: string, _type: unknown, value: unknown) {
        this.params[name] = value;
        return this;
      }
      async query(statement: string) {
        mocks.calls.push({ sql: statement, params: { ...this.params } });
        if (mocks.failContaining && statement.includes(mocks.failContaining)) {
          throw new Error('synthetic SQL write failure');
        }
        return mocks.results.shift() ?? { recordset: [] };
      }
    },
  },
}));

import {
  finalizeReferralSaleTransaction,
  prepareReferralSaleTransaction,
} from '@/lib/referrals/referralSaleTransaction.service';
import { ReferralCheckoutError } from '@/lib/referrals/referralCheckoutPolicy';

const tx = {} as import('mssql').Transaction;
const tenantId = '01234567-89ab-4cde-8fab-0123456789ab';
const CODE = 'CUT-ABCDEF0123456789ABCDEF01';
const input = { tenantId, clientId: 99, referralCode: CODE };
const invoice = { invID: 9001, invType: 'مبيعات', expectedGrandTotal: 50 };

beforeEach(() => {
  process.env.POS_REFERRAL_CHECKOUT_ENABLED = 'true';
  mocks.calls = [];
  mocks.results = [];
  mocks.failContaining = null;
});
afterEach(() => delete process.env.POS_REFERRAL_CHECKOUT_ENABLED);

describe('single-transaction referral accounting (#227)', () => {
  it('feature off leaves normal cashier transaction untouched', async () => {
    delete process.env.POS_REFERRAL_CHECKOUT_ENABLED;
    expect(await prepareReferralSaleTransaction(tx, { tenantId, clientId: 99 })).toBeNull();
    expect(mocks.calls).toHaveLength(0);
    await expect(prepareReferralSaleTransaction(tx, input)).rejects.toBeInstanceOf(ReferralCheckoutError);
  });

  it('locks the customer for EVERY sale when enabled, including an ordinary sale', async () => {
    mocks.results = [{ recordset: [{ ClientID: 99 }] }];
    const prep = await prepareReferralSaleTransaction(tx, { tenantId, clientId: 99 });
    expect(prep).toMatchObject({ tenantId, clientId: 99, reservation: null });
    expect(mocks.calls).toHaveLength(1);
    expect(mocks.calls[0]?.sql).toContain('WITH (UPDLOCK, HOLDLOCK)');
    expect(mocks.calls[0]?.sql).toContain('TenantId = @tenantId');
    expect(mocks.calls[0]?.params).toMatchObject({ tenantId, clientId: 99 });
  });

  it('refuses an out-of-tenant or nonexistent referred customer', async () => {
    mocks.results = [{ recordset: [] }];
    await expect(prepareReferralSaleTransaction(tx, input)).rejects.toThrowError(
      expect.objectContaining({ code: 'REFERRAL_NOT_ELIGIBLE' }),
    );
    expect(mocks.calls).toHaveLength(1);
  });

  it('reserves a valid referral under the customer row lock before issuing money', async () => {
    mocks.results = [
      { recordset: [{ ClientID: 99 }] },
      { recordset: [{ ReferralCodeID: 111, ReferrerClientID: 45 }] },
      { recordset: [{ ReferrerPaid: 1, ReferredPaid: 0, Claimed: 0 }] },
      { recordset: [{ ClaimID: 999 }] },
    ];
    const prep = await prepareReferralSaleTransaction(tx, input);
    expect(prep?.reservation).toMatchObject({
      tenantId, referredClientId: 99, referrerClientId: 45,
      claimId: 999, referralCodeId: 111,
    });
    expect(mocks.calls.map(c => c.sql).join('\n')).toContain('INSERT INTO dbo.TblReferralVisitClaim');
    expect(mocks.calls[1]?.params).toMatchObject({ tenantId, code: CODE });
    expect(mocks.calls[2]?.params).toMatchObject({ tenantId, referrerId: 45, referredId: 99 });
  });

  it.each([
    [{ ReferrerPaid: 0, ReferredPaid: 0, Claimed: 0 }],
    [{ ReferrerPaid: 1, ReferredPaid: 1, Claimed: 0 }],
    [{ ReferrerPaid: 1, ReferredPaid: 0, Claimed: 1 }],
  ])('rejects ineligible/visited/previously claimed customers before inserting claim', async (facts) => {
    mocks.results = [
      { recordset: [{ ClientID: 99 }] },
      { recordset: [{ ReferralCodeID: 111, ReferrerClientID: 45 }] },
      { recordset: [facts] },
    ];
    await expect(prepareReferralSaleTransaction(tx, input)).rejects.toBeInstanceOf(ReferralCheckoutError);
    expect(mocks.calls).toHaveLength(3);
  });

  it('denies self-referral before issuing a claim', async () => {
    mocks.results = [
      { recordset: [{ ClientID: 99 }] },
      { recordset: [{ ReferralCodeID: 111, ReferrerClientID: 99 }] },
    ];
    await expect(prepareReferralSaleTransaction(tx, input)).rejects.toBeInstanceOf(ReferralCheckoutError);
    expect(mocks.calls).toHaveLength(2);
  });

  it('writes 20 percent voucher and own permanent code only AFTER paid invoice check', async () => {
    const prep = {
      tenantId, clientId: 99,
      reservation: {
        tenantId, referredClientId: 99, referrerClientId: 45, referralCodeId: 111, claimId: 999,
      },
    };
    mocks.results = [
      { recordset: [{ GrandTotal: 50, Dis: 50, DisVal: 50 }] },
      { recordset: [], rowsAffected: [1] },
      { recordset: [] },
      { recordset: [] },
      { recordset: [] },
    ];
    await finalizeReferralSaleTransaction(tx, prep, invoice);
    expect(mocks.calls).toHaveLength(5);
    expect(mocks.calls[0]?.sql).toContain('SUM(p.PayValue)');
    expect(mocks.calls[1]?.sql).toContain('UPDATE dbo.TblReferralVisitClaim');
    expect(mocks.calls[2]?.sql).toContain('INSERT INTO dbo.TblReferralDiscountVoucher');
    expect(mocks.calls[2]?.params).toMatchObject({ referrerId: 45, claimId: 999, tenantId });
    expect(mocks.calls[4]?.sql).toContain('INSERT INTO dbo.TblReferralCustomerCode');
    expect(mocks.calls[4]?.params.code).toMatch(/^CUT-[0-9A-F]{24}$/);
  });

  it('does not create voucher or referral code when invoice was not fully paid', async () => {
    const prep = {
      tenantId, clientId: 99,
      reservation: {
        tenantId, referredClientId: 99, referrerClientId: 45, referralCodeId: 111, claimId: 999,
      },
    };
    mocks.results = [{ recordset: [] }];
    await expect(finalizeReferralSaleTransaction(tx, prep, invoice)).rejects.toThrowError(
      expect.objectContaining({ code: 'REFERRAL_INVOICE_NOT_PAID' }),
    );
    expect(mocks.calls).toHaveLength(1);
  });

  it('fails the enclosing invoice transaction if issuing the voucher throws', async () => {
    const prep = {
      tenantId, clientId: 99,
      reservation: {
        tenantId, referredClientId: 99, referrerClientId: 45, referralCodeId: 111, claimId: 999,
      },
    };
    mocks.results = [
      { recordset: [{ GrandTotal: 50, Dis: 50, DisVal: 50 }] },
      { recordset: [], rowsAffected: [1] },
    ];
    mocks.failContaining = 'INSERT INTO dbo.TblReferralDiscountVoucher';
    await expect(finalizeReferralSaleTransaction(tx, prep, invoice)).rejects.toThrowError(
      'synthetic SQL write failure',
    );
    expect(mocks.calls.some(c => c.sql.includes('INSERT INTO dbo.TblReferralCustomerCode'))).toBe(false);
  });

  it('keeps existing permanent code stable across additional paid visits', async () => {
    const prep = { tenantId, clientId: 99, reservation: null };
    mocks.results = [
      { recordset: [{ GrandTotal: 50, Dis: 0, DisVal: 0 }] },
      { recordset: [{ ReferralCodeID: 8, ActivatedAtUtc: new Date() }] },
    ];
    await finalizeReferralSaleTransaction(tx, prep, invoice);
    expect(mocks.calls).toHaveLength(2);
    expect(mocks.calls.some(c => c.sql.includes('INSERT INTO dbo.TblReferralCustomerCode'))).toBe(false);
  });
});

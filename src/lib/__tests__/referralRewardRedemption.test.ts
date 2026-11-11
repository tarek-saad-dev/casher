import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/referrals/referralCatalogPriceGuard', () => ({
  assertReferralCheckoutCatalogPrices: vi.fn().mockResolvedValue(undefined),
}));
const mock = vi.hoisted(() => ({
  calls: [] as Array<{ query: string; params: Record<string, unknown> }>,
  results: [] as Array<{ recordset: Record<string, unknown>[]; rowsAffected?: number[] }>,
  failContaining: '' as string,
}));
vi.mock('@/lib/db', () => ({
  sql: {
    BigInt: 'BIGINT', Int: 'INT', UniqueIdentifier: 'UUID',
    NVarChar: () => 'NVARCHAR', Decimal: () => 'DECIMAL',
    Request: class {
      params: Record<string, unknown> = {};
      input(name: string, _type: unknown, value: unknown) {
        this.params[name] = value;
        return this;
      }
      async query(query: string) {
        if (query.includes("OBJECT_ID(N'dbo.TblReferralCustomerCode'")) {
          return { recordset: [{ Ready: 1 }] };
        }
        mock.calls.push({ query, params: { ...this.params } });
        if (mock.failContaining && query.includes(mock.failContaining)) {
          throw new Error('synthetic SQL failure');
        }
        return mock.results.shift() ?? { recordset: [] };
      }
    },
  },
}));

import {
  prepareReferralSaleTransaction,
  finalizeReferralSaleTransaction,
} from '@/lib/referrals/referralSaleTransaction.service';

const tx = {} as import('mssql').Transaction;
const tenantId = '01234567-89ab-4cde-8fab-0123456789ab';
const input = { tenantId, clientId: 45, referralVoucherId: 300,
  items: [{ proId: 9, sPrice: 200, qty: 1, bonus: 0 }] };
const invoice = { invID: 7001, invType: 'مبيعات', expectedGrandTotal: 160 };

beforeEach(() => {
  process.env.POS_REFERRAL_CHECKOUT_ENABLED = 'true';
  process.env.POS_REFERRAL_REDEEM_ENABLED = 'true';
  mock.calls = []; mock.results = []; mock.failContaining = '';
});
afterEach(() => {
  delete process.env.POS_REFERRAL_CHECKOUT_ENABLED;
  delete process.env.POS_REFERRAL_REDEEM_ENABLED;
});

describe('transactional referral voucher redemption', () => {
  it('forbids redemption while the reward gate is disabled', async () => {
    delete process.env.POS_REFERRAL_REDEEM_ENABLED;
    mock.results = [{ recordset: [{ ClientID: 45 }] }];
    await expect(prepareReferralSaleTransaction(tx, input)).rejects.toThrowError(
      expect.objectContaining({ status: 409 }),
    );
    expect(mock.calls.some(c => c.query.includes('TblReferralDiscountVoucher'))).toBe(false);
  });

  it('rejects expired, spent, foreign-tenant or wrong-owner voucher before invoice write', async () => {
    mock.results = [{ recordset: [{ ClientID: 45 }] }, { recordset: [] }];
    await expect(prepareReferralSaleTransaction(tx, input)).rejects.toThrowError(
      expect.objectContaining({ code: 'REFERRAL_VOUCHER_UNAVAILABLE', status: 409 }),
    );
    expect(mock.calls[1]?.query).toContain('WITH (UPDLOCK, HOLDLOCK)');
    expect(mock.calls[1]?.query).toContain('v.TenantId = @tenantId');
    expect(mock.calls[1]?.query).toContain('v.ReferrerClientID = @clientId');
    expect(mock.calls[1]?.query).toContain("v.Status = N'ACTIVE'");
    expect(mock.calls[1]?.query).toContain("c.Status = N'APPLIED'");
    expect(mock.calls[1]?.params).toMatchObject({ tenantId, clientId: 45, voucherId: 300 });
  });

  it('only marks a voucher USED after fully paid invoice/payment and inside same transaction', async () => {
    mock.results = [
      { recordset: [{ ClientID: 45 }] },
      { recordset: [{ VoucherID: 300 }] },
      { recordset: [{ GrandTotal: 160, Dis: 20, DisVal: 40 }] },
      { recordset: [], rowsAffected: [1] },
      { recordset: [{ ReferralCodeID: 1, ActivatedAtUtc: new Date() }] },
    ];
    const prep = await prepareReferralSaleTransaction(tx, input);
    expect(prep?.voucherReservation).toEqual({ voucherId: 300 });
    expect(mock.calls).toHaveLength(2);
    await finalizeReferralSaleTransaction(tx, prep, invoice);
    expect(mock.calls).toHaveLength(5);
    expect(mock.calls[2]?.query).toContain('SUM(p.PayValue)');
    expect(mock.calls[3]?.query).toContain("Status = N'USED'");
    expect(mock.calls[3]?.query).toContain('UsedAtUtc = SYSUTCDATETIME()');
    expect(mock.calls[3]?.params).toMatchObject({
      tenantId, clientId: 45, voucherId: 300, invId: 7001,
    });
    expect(mock.calls.filter(c => c.query.includes("Status = N'USED'"))).toHaveLength(1);
  });

  it('does not consume a voucher if the invoice is only partially paid', async () => {
    mock.results = [{ recordset: [] }];
    const prep = { tenantId, clientId: 45, reservation: null,
      voucherReservation: { voucherId: 300 } };
    await expect(finalizeReferralSaleTransaction(tx, prep, invoice)).rejects.toThrowError(
      expect.objectContaining({ code: 'REFERRAL_INVOICE_NOT_PAID' }),
    );
    expect(mock.calls).toHaveLength(1);
  });

  it('rejects any invoice without a persisted 20% voucher discount', async () => {
    mock.results = [{ recordset: [{ GrandTotal: 160, Dis: 0, DisVal: 0 }] }];
    const prep = { tenantId, clientId: 45, reservation: null,
      voucherReservation: { voucherId: 300 } };
    await expect(finalizeReferralSaleTransaction(tx, prep, invoice)).rejects.toThrowError(
      expect.objectContaining({ code: 'REFERRAL_INVOICE_NOT_PAID' }),
    );
    expect(mock.calls.some(c => c.query.includes('UPDATE dbo.TblReferralDiscountVoucher'))).toBe(false);
  });

  it('forces invoice transaction rollback if a second cashier spent the same voucher', async () => {
    mock.results = [
      { recordset: [{ GrandTotal: 160, Dis: 20, DisVal: 40 }] },
      { recordset: [], rowsAffected: [0] },
    ];
    const prep = { tenantId, clientId: 45, reservation: null,
      voucherReservation: { voucherId: 300 } };
    await expect(finalizeReferralSaleTransaction(tx, prep, invoice)).rejects.toThrowError(
      expect.objectContaining({ code: 'REFERRAL_VOUCHER_UNAVAILABLE' }),
    );
    expect(mock.calls.some(c => c.query.includes('INSERT INTO dbo.TblReferralCustomerCode'))).toBe(false);
  });

  it('propagates SQL failure so owning writer rolls back both payment and voucher', async () => {
    mock.results = [{ recordset: [{ GrandTotal: 160, Dis: 20, DisVal: 40 }] }];
    mock.failContaining = 'UPDATE dbo.TblReferralDiscountVoucher';
    const prep = { tenantId, clientId: 45, reservation: null,
      voucherReservation: { voucherId: 300 } };
    await expect(finalizeReferralSaleTransaction(tx, prep, invoice))
      .rejects.toThrow('synthetic SQL failure');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  sqlCalls: [] as Array<{ query: string; params: Record<string, unknown> }>,
  responses: [] as Array<{ recordset: Record<string, unknown>[]; rowsAffected?: number[] }>,
  failContaining: '',
}));
vi.mock('@/lib/db', () => ({
  sql: {
    Int: 'INT', BigInt: 'BIGINT', UniqueIdentifier: 'UUID',
    Request: class FakeSQLRequest {
      params: Record<string, unknown> = {};
      input(name: string, _kind: unknown, value: unknown) {
        this.params[name] = value;
        return this;
      }
      async query(query: string) {
        mocks.sqlCalls.push({ query, params: { ...this.params } });
        if (mocks.failContaining && query.includes(mocks.failContaining)) {
          throw new Error('synthetic failed audited transaction');
        }
        return mocks.responses.shift() ?? { recordset: [], rowsAffected: [0] };
      }
    },
  },
}));
import {
  referralRefundEnabled,
  reverseReferralInvoiceOnFullRefund,
  getReferralRefundAuditSnapshot,
} from '@/lib/referrals/referralInvoiceRefund.service';

const tx = {} as import('mssql').Transaction;
const input = {
  tenantId: '01234567-89ab-4cde-8fab-0123456789ab',
  invoiceId: 1005,
};
const ready = { recordset: [{ HasClaims: 1, HasVouchers: 1 }] };
const none = { recordset: [] as Record<string, unknown>[] };
const owner = { recordset: [{ invID: 1005 }] };
const appliedClaim = { recordset: [{ ClaimID: 22, Status: 'APPLIED' }] };
const reversedClaim = { recordset: [{ ClaimID: 22, Status: 'REVERSED' }] };
const spentVoucher = { recordset: [{ VoucherID: 90, Status: 'USED' }] };

beforeEach(() => {
  delete process.env.POS_REFERRAL_REVERSAL_ENABLED;
  mocks.sqlCalls = [];
  mocks.responses = [];
  mocks.failContaining = '';
});
afterEach(() => delete process.env.POS_REFERRAL_REVERSAL_ENABLED);

describe('FULL SALE refund / reversal, reward always honored (#235)', () => {
  it('defaults disabled and leaves ordinary historical pre-schema invoice delete unchanged', async () => {
    expect(referralRefundEnabled()).toBe(false);
    mocks.responses = [{ recordset: [{ HasClaims: 0, HasVouchers: 0 }] }];
    const result = await reverseReferralInvoiceOnFullRefund(tx, input);
    expect(result).toEqual({
      claimId: null, voucherId: null, rewardPreserved: false, voucherRestored: false,
    });
    expect(mocks.sqlCalls).toHaveLength(1);
  });

  it('fails closed on accidental runtime enable before DRVO-023 is installed', async () => {
    process.env.POS_REFERRAL_REVERSAL_ENABLED = 'true';
    mocks.responses = [{ recordset: [{ HasClaims: 0, HasVouchers: 0 }] }];
    await expect(reverseReferralInvoiceOnFullRefund(tx, input)).rejects.toThrowError(
      expect.objectContaining({ code: 'REFERRAL_SCHEMA_UNAVAILABLE', status: 503 }),
    );
    expect(mocks.sqlCalls).toHaveLength(1);
  });

  it('rejects partially applied schema rather than deleting an invoice without consistent ledger', async () => {
    mocks.responses = [{ recordset: [{ HasClaims: 1, HasVouchers: 0 }] }];
    await expect(reverseReferralInvoiceOnFullRefund(tx, input)).rejects.toThrowError(
      expect.objectContaining({ status: 503 }),
    );
  });

  it('does nothing to ordinary invoices even if DRVO-023 schema exists', async () => {
    mocks.responses = [ready, none, none];
    const result = await reverseReferralInvoiceOnFullRefund(tx, input);
    expect(result.rewardPreserved).toBe(false);
    expect(mocks.sqlCalls).toHaveLength(3);
    expect(mocks.sqlCalls.every(call => !call.query.includes('UPDATE dbo.'))).toBe(true);
  });

  it('blocks linked source-invoice refunds until explicit server policy switch enabled', async () => {
    mocks.responses = [ready, appliedClaim, none];
    await expect(reverseReferralInvoiceOnFullRefund(tx, input)).rejects.toThrowError(
      expect.objectContaining({ code: 'REFERRAL_NOT_ELIGIBLE', status: 409 }),
    );
    expect(mocks.sqlCalls).toHaveLength(3);
  });

  it('reverses source claim and KEEPS its 20pct reward valid without voucher writes', async () => {
    process.env.POS_REFERRAL_REVERSAL_ENABLED = 'true';
    mocks.responses = [
      ready, appliedClaim, none, owner,
      { recordset: [], rowsAffected: [1] },
    ];
    const result = await reverseReferralInvoiceOnFullRefund(tx, input);
    expect(result).toEqual({
      claimId: 22, voucherId: null, rewardPreserved: true, voucherRestored: false,
    });
    const update = mocks.sqlCalls[4];
    expect(update?.query).toContain('UPDATE dbo.TblReferralVisitClaim');
    expect(update?.query).toContain("Status = N'REVERSED'");
    expect(update?.query).toContain('ReversedAtUtc = SYSUTCDATETIME()');
    expect(update?.params).toMatchObject({
      tenantId: input.tenantId, invId: 1005, claimId: 22,
    });
    expect(mocks.sqlCalls.some(c => /UPDATE dbo.TblReferralDiscountVoucher/.test(c.query)))
      .toBe(false);
    expect(mocks.sqlCalls[1]?.query).toContain('WITH (UPDLOCK, HOLDLOCK)');
    expect(mocks.sqlCalls[3]?.query).toContain('l.TenantId = @tenantId');
  });

  it('restores the SAME voucher on refund of a purchase redeemed with 20pct, no duplicate grant', async () => {
    process.env.POS_REFERRAL_REVERSAL_ENABLED = 'true';
    mocks.responses = [ready, none, spentVoucher, owner,
      { recordset: [], rowsAffected: [1] }];
    const result = await reverseReferralInvoiceOnFullRefund(tx, input);
    expect(result).toEqual({
      claimId: null, voucherId: 90, rewardPreserved: false, voucherRestored: true,
    });
    const update = mocks.sqlCalls[4];
    expect(update?.query).toContain('UPDATE dbo.TblReferralDiscountVoucher');
    expect(update?.query).toContain("Status = N'ACTIVE'");
    expect(update?.query).toContain('UsedInvID = NULL');
    expect(update?.query).toContain('UsedAtUtc = NULL');
    expect(update?.query).toContain("c.Status IN (N'APPLIED', N'REVERSED')");
    expect(update?.params).toMatchObject({
      tenantId: input.tenantId, invId: 1005, voucherId: 90,
    });
    expect(mocks.sqlCalls.every(c => !c.query.includes('INSERT INTO dbo.TblReferralDiscountVoucher')))
      .toBe(true);
    // Unmodified ExpiresAtUtc: no extension of reward expiry on refund.
    expect(update?.query).not.toContain('ExpiresAtUtc =');
  });

  it('cannot double reverse a claim or restore a voucher that is no longer USED', async () => {
    process.env.POS_REFERRAL_REVERSAL_ENABLED = 'true';
    mocks.responses = [ready, reversedClaim, none, owner];
    await expect(reverseReferralInvoiceOnFullRefund(tx, input)).rejects.toThrowError(
      expect.objectContaining({ status: 409 }),
    );
    expect(mocks.sqlCalls).toHaveLength(4);
    mocks.sqlCalls = [];
    mocks.responses = [ready, none, { recordset: [{ VoucherID: 90, Status: 'ACTIVE' }] }, owner];
    await expect(reverseReferralInvoiceOnFullRefund(tx, input)).rejects.toThrowError(
      expect.objectContaining({ status: 409 }),
    );
  });

  it('fails closed on concurrent row status change (UPDATE touches zero rows)', async () => {
    process.env.POS_REFERRAL_REVERSAL_ENABLED = 'true';
    mocks.responses = [ready, appliedClaim, none, owner,
      { recordset: [], rowsAffected: [0] }];
    await expect(reverseReferralInvoiceOnFullRefund(tx, input)).rejects.toThrowError(
      expect.objectContaining({ status: 409 }),
    );
  });

  it('refuses cross-tenant invoice even with matching supplied legacy invID', async () => {
    process.env.POS_REFERRAL_REVERSAL_ENABLED = 'true';
    mocks.responses = [ready, appliedClaim, none, none];
    await expect(reverseReferralInvoiceOnFullRefund(tx, input)).rejects.toThrowError(
      expect.objectContaining({ status: 404 }),
    );
    expect(mocks.sqlCalls.some(c => c.query.includes('UPDATE dbo.'))).toBe(false);
  });

  it('rejects ambiguous invoice ledger: duplicated source claims or both claim and USED reward', async () => {
    process.env.POS_REFERRAL_REVERSAL_ENABLED = 'true';
    mocks.responses = [ready,
      { recordset: [{ ClaimID: 22, Status: 'APPLIED' }, { ClaimID: 23, Status: 'APPLIED' }] }, none,
    ];
    await expect(reverseReferralInvoiceOnFullRefund(tx, input)).rejects.toThrowError(
      expect.objectContaining({ status: 409 }),
    );
    mocks.sqlCalls = [];
    mocks.responses = [ready, appliedClaim, spentVoucher];
    await expect(reverseReferralInvoiceOnFullRefund(tx, input)).rejects.toThrowError(
      expect.objectContaining({ status: 409 }),
    );
  });

  it('propagates SQL failure to the existing audited DELETE rollback', async () => {
    process.env.POS_REFERRAL_REVERSAL_ENABLED = 'true';
    mocks.responses = [ready, appliedClaim, none, owner];
    mocks.failContaining = 'UPDATE dbo.TblReferralVisitClaim';
    await expect(reverseReferralInvoiceOnFullRefund(tx, input))
      .rejects.toThrow('synthetic failed audited transaction');
  });

  it('audits ORIGINAL claim/reward identity and state before reverting sale', async () => {
    mocks.responses = [ready, appliedClaim, none,
      { recordset: [{ VoucherID: 111, Status: 'ACTIVE' }] }];
    const snap = await getReferralRefundAuditSnapshot(tx, input.tenantId, 1005);
    expect(snap).toEqual({
      claimId: 22, claimStatus: 'APPLIED',
      issuedRewardId: 111, issuedRewardStatus: 'ACTIVE',
      redeemedVoucherId: null, redeemedVoucherStatus: null,
    });
    expect(mocks.sqlCalls.some(c => c.query.includes('UPDATE dbo.'))).toBe(false);
  });

  it('audit snapshot captures consumed voucher invoice linkage without changing it', async () => {
    mocks.responses = [ready, none, spentVoucher];
    const snap = await getReferralRefundAuditSnapshot(tx, input.tenantId, 1005);
    expect(snap).toMatchObject({ redeemedVoucherId: 90, redeemedVoucherStatus: 'USED' });
    expect(mocks.sqlCalls).toHaveLength(3);
  });

  it('throws when earned claim is missing exactly-one reward (no silent reward loss)', async () => {
    mocks.responses = [ready, appliedClaim, none, none];
    await expect(getReferralRefundAuditSnapshot(tx, input.tenantId, 1005))
      .rejects.toThrowError(expect.objectContaining({ status: 409 }));
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('approved referral refund policy integrated with audited DELETE (#235)', () => {
  const file = readFileSync('src/app/api/sales/[id]/route.ts', 'utf8');
  const del = file.slice(file.indexOf('// DELETE /api/sales/[id]'));
  const edits = file.slice(0, file.indexOf('// DELETE /api/sales/[id]'));

  it('requires existing session/branch financial authorization and reason', () => {
    expect(del).toContain('requireTenantSession()');
    expect(del).toContain('!reason');
    expect(del).toContain('loadAndAuthorizeFinancialMutation(');
    expect(del).toContain('executeAuditedAction({');
    expect(del).toContain("actionType: 'delete_invoice'");
    expect(del).toContain('reason,');
  });

  it('snapshots referral ledger BEFORE reversal, and records oldData in audited transaction', () => {
    const snapshot = del.indexOf('await getReferralRefundAuditSnapshot(');
    const exec = del.indexOf('execute: async (transaction) => {');
    const reverse = del.indexOf('await reverseReferralInvoiceOnFullRefund(');
    const deletePort = del.indexOf('await deleteSale(');
    const deleteLegacy = del.indexOf('await deleteInvoice(');
    expect(snapshot).toBeGreaterThan(0);
    expect(exec).toBeGreaterThan(snapshot);
    expect(reverse).toBeGreaterThan(exec);
    expect(deletePort).toBeGreaterThan(reverse);
    expect(deleteLegacy).toBeGreaterThan(reverse);
    expect(del).toContain('referralLedger');
    expect(del).toContain('tenantId: String(session.TenantId)');
    expect(del).toContain('referralRefund: auditResult.data');
  });

  it('invoice edits remain guarded until separate audited refund; not silently allowed', () => {
    expect(edits).toContain('assertReferralInvoiceNotMutated(');
    expect(edits).not.toContain('reverseReferralInvoiceOnFullRefund(transaction');
  });

  it('reward remains eligible after a source claim reversal; no revoke in refund SQL', () => {
    const source = readFileSync('src/lib/referrals/referralInvoiceRefund.service.ts', 'utf8');
    expect(source).toContain("SET Status = N'REVERSED', ReversedAtUtc = SYSUTCDATETIME()");
    expect(source).not.toContain("SET Status = N'REVOKED'");
    expect(source).toContain("SET Status = N'ACTIVE', UsedAtUtc = NULL");
    expect(source).toContain("c.Status IN (N'APPLIED', N'REVERSED')");
    const wallet = readFileSync('src/lib/referrals/referralRewardWallet.service.ts', 'utf8');
    expect(wallet).toContain("c.Status IN (N'APPLIED', N'REVERSED')");
    const sale = readFileSync('src/lib/referrals/referralSaleTransaction.service.ts', 'utf8');
    expect(sale).toContain("c.Status IN (N'APPLIED', N'REVERSED')");
  });
});

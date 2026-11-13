import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(path, 'utf8');

describe('CUT referral FULL integration (#244): buyer -> cashier -> tenant ledger -> manager', () => {
  it('registers the exact DRVO-023 tenant-owned schema in the immutable migration manifest', () => {
    const sql = source('db/drvo-migrations/023-referral-discounts/schema.sql');
    const manifest = source('scripts/drvo/migrations/index.ts');
    expect(sql).toContain('CREATE TABLE dbo.TblReferralCustomerCode');
    expect(sql).toContain('CREATE TABLE dbo.TblReferralVisitClaim');
    expect(sql).toContain('CREATE TABLE dbo.TblReferralDiscountVoucher');
    expect(sql).toContain('CONSTRAINT UQ_ReferralVisitClaim_Referred UNIQUE (TenantId, ReferredClientID)');
    expect(manifest).toContain("import { referralDiscountMigration } from './023-referral-discounts'");
    expect(manifest).toContain('  referralDiscountMigration,');
  });

  it('provides staff-authenticated tenant-specific preview, wallet and customer profile GET', () => {
    const endpoints = [
      'src/app/api/pos/referrals/preview/route.ts',
      'src/app/api/pos/referrals/wallet/route.ts',
      'src/app/api/pos/referrals/customer-profile/route.ts',
    ];
    for (const file of endpoints) {
      const route = source(file);
      expect(route).toContain('requireTenantSession()');
      expect(route).toMatch(/TenantId|tenantId/);
      expect(route).not.toMatch(/process\.env\.DB_PASSWORD|GET.*INSERT INTO dbo\./);
    }
  });

  it('keeps both new-sale writer paths guarded by the SAME transactional reward service', () => {
    const core = source('src/lib/referrals/referralSaleTransaction.service.ts');
    const legacy = source('src/lib/sales/legacyRouteSaleCreate.ts');
    const extracted = source('src/apps/pos/application/createSale.ts');
    for (const writer of [legacy, extracted]) {
      expect(writer).toContain('prepareReferralSaleTransaction(');
      expect(writer).toContain('finalizeReferralSaleTransaction(');
      expect(writer).toContain('referralVoucherId: input.referralVoucherId');
    }
    expect(core).toContain('WITH (UPDLOCK, HOLDLOCK)');
    expect(core).toContain("SET Status = N'USED'");
    expect(core).toContain("SET Status = N'APPLIED'");
    expect(core).toContain('assertReferralCheckoutCatalogPrices');
  });

  it('keeps the server authoritative and treats 50% and 20% as exclusive intents', () => {
    const route = source('src/app/api/sales/route.ts');
    expect(route).toContain('priceFirstVisitReferral(');
    expect(route).toContain('priceReferralRewardVoucher(');
    expect(route).toContain('parseReferralRewardVoucherId(');
    expect(route).toContain('referralVoucherId,');
    expect(route).toContain('referralCode,');
    const policy = source('src/lib/referrals/referralCheckoutPolicy.ts');
    expect(policy).toContain('POS_REFERRAL_REDEEM_ENABLED');
    expect(policy).toContain('POS_REFERRAL_CHECKOUT_ENABLED');
    expect(policy).toContain('REFERRAL_DISCOUNT_CONFLICT');
  });

  it('cashier discount UI sends code OR voucherId while preserving the backend CreateSalePayload', () => {
    const page = source('src/app/income/pos/page.tsx');
    const state = source('src/hooks/useSaleState.ts');
    const types = source('src/lib/types.ts');
    expect(page).toContain('...referralSalePayloadDiscount(state)');
    expect(page).toContain('onApplyReferral: applyReferral,');
    expect(page).toContain('onApplyReferralReward: applyReferralReward,');
    expect(state).toContain("case 'APPLY_REFERRAL':");
    expect(state).toContain("case 'APPLY_REFERRAL_REWARD':");
    expect(state).toContain('paymentAllocations: []');
    const saleState = types.slice(types.indexOf('export interface SaleState'), types.indexOf('export interface SaleTotals'));
    const apiPayload = types.slice(types.indexOf('export interface CreateSalePayload'), types.indexOf('export interface UpdateSalePayload'));
    expect(saleState).toContain('referralCode?: string | null;');
    expect(saleState).toContain('referralVoucherId?: number | null;');
    expect(apiPayload).toContain('referralCode?: string;');
    expect(apiPayload).toContain('referralVoucherId?: number;');
  });

  it('covers both 50% preview and 20% wallet selectors in the same mobile/desktop invoice panel', () => {
    const panel = source('src/components/pos/PosInvoicePanel.tsx');
    const mobile = source('src/components/pos/mobile/MobileInvoiceSheet.tsx');
    expect(panel).toContain('<PosReferralPreview');
    expect(panel).toContain('<PosReferralRewardWallet');
    expect(panel).toContain('canUsePosReferralCart(state)');
    expect(panel).toContain('referralRewardApplied=');
    expect(mobile).toContain('onApplyReferralReward');
  });

  it('shows the real permanent code in customer card while the manager dashboard reads ledger, not mocks', () => {
    const customer = source('src/components/pos/CustomerSearch.tsx');
    const admin = source('src/app/admin/cut-club/referrals/page.tsx');
    const service = source('src/lib/referrals/referralAdminDashboard.service.ts');
    expect(customer).toContain('<PosCustomerReferralProfile');
    expect(admin).toContain('/api/admin/cut-club/referrals?');
    expect(service).toContain("c.Status = N'REVERSED'");
    expect(service).toContain('sql.UniqueIdentifier, input.tenantId');
    expect(admin).not.toContain('mockStats');
    expect(admin).not.toContain('mockReferrals');
  });

  it('preserves earned rewards if source invoice was fully refunded and blocks unreviewed invoice edit', () => {
    const refund = source('src/lib/referrals/referralInvoiceRefund.service.ts');
    const wallet = source('src/lib/referrals/referralRewardWallet.service.ts');
    expect(refund).toContain("SET Status = N'REVERSED'");
    expect(refund).toContain("SET Status = N'ACTIVE'");
    expect(refund).not.toContain("SET Status = N'REVOKED'");
    expect(wallet).toContain("c.Status IN (N'APPLIED', N'REVERSED')");
    expect(source('src/app/api/sales/[id]/route.ts')).toContain('assertReferralInvoiceNotMutated(');
  });

  it('keeps all public switches OFF unless deliberately enabled by environment', () => {
    expect(source('src/lib/referrals/posReferralCheckoutPolicy.ts'))
      .toContain("process.env.NEXT_PUBLIC_POS_REFERRAL_CHECKOUT_ENABLED === 'true'");
    expect(source('src/lib/referrals/customerReferralProfile.service.ts'))
      .toContain("process.env.POS_REFERRAL_PROFILE_ENABLED === 'true'");
    expect(source('src/lib/referrals/referralAdminDashboard.service.ts'))
      .toContain("process.env.POS_REFERRAL_ADMIN_ENABLED === 'true'");
    expect(source('src/lib/referrals/referralInvoiceRefund.service.ts'))
      .toContain("process.env.POS_REFERRAL_REVERSAL_ENABLED === 'true'");
  });

  it('staging migration SQL gate uses only protected last132_agent and never touches production DB', () => {
    const gate = source('.github/workflows/drvo-staging-gate.yml');
    expect(gate).toContain("DB_DATABASE: last132_agent");
    expect(gate).toContain("DB_USER: drvo_agent");
    expect(gate).toContain("github.event.pull_request.head.ref == 'feat/cut-referrals-integration-244'");
    expect(gate).toContain('scripts/drvo/drvo023-referral-staging-smoke.ts');
  });
});

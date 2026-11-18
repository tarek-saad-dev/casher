import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CUT_CLUB_CASHER_BOOT_TENANT,
  stagingServiceApprovalJson,
  approvedProductionRewardToService,
  STAGING_VOUCHER_INVOICE_FLAG,
  eligibleStagingVoucher,
  eligibleStagingInvoiceBenefit,
} from "@/lib/cut-club/stagingInvoiceClaim";
import {
  approvedCutClubServiceId,
} from "@/lib/cut-club/reviewedServiceEntitlements";

const source = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("CUT CLUB owner-approved live reward-service mappings (STAGING ONLY)", () => {
  it("pins all four approvals to actual CASHER_BOOT tenant and never includes PH1GTEST or demo tenant", () => {
    expect(approvedProductionRewardToService).toEqual({ 15:39, 16:22, 17:11, 18:9 });
    expect(CUT_CLUB_CASHER_BOOT_TENANT).toBe("413d433e-f36b-1410-8820-009ec495c7e1");
    const json=stagingServiceApprovalJson();
    for(const [item,service] of [[15,39],[16,22],[17,11],[18,9]]){
      expect(approvedCutClubServiceId({
        trustedTenantId: CUT_CLUB_CASHER_BOOT_TENANT,
        rewardItemId: item, dbServiceId: null, approvalJson: json,
      })).toBe(service);
    }
    expect(approvedCutClubServiceId({
      trustedTenantId: "18cb423e-f36b-1410-8822-009ec495c7e1",
      rewardItemId:17,dbServiceId:null,approvalJson:json,
    })).toBeNull();
    expect(approvedCutClubServiceId({
      trustedTenantId: CUT_CLUB_CASHER_BOOT_TENANT,
      rewardItemId:17,dbServiceId:29,approvalJson:json,
    })).toBeNull();
  });
  it("exact staging DB and login + feature flag + operator branch allowlist are required before writes", () => {
    const src=source("src/lib/cut-club/stagingInvoiceClaim.ts");
    expect(STAGING_VOUCHER_INVOICE_FLAG).toBe("CUT_CLUB_STAGING_CLAIM_WRITE_ENABLED");
    expect(src).toContain('c.DbName === "last132_agent" && c.LoginName === "drvo_agent"');
    expect(src).toContain('process.env[STAGING_VOUCHER_INVOICE_FLAG] !== "true"');
    expect(src).toContain("CUT_CLUB_STAGING_APPROVED_BRANCHES_JSON");
    expect(src).toContain("isCutClubCashierBranchApproved");
    expect(src).toContain("si.SalonID IS NULL");
    expect(src).toContain("c.TenantId=@tenantId");
    expect(src).toContain("ci.ClientID=@clientId");
    expect(src).toContain("AND isDeleted=0");
  });
  it("both POS and legacy route save claim BEFORE commit; unauthenticated caller cannot supply scope", () => {
    const api=source("src/app/api/sales/route.ts");
    const pos=source("src/apps/pos/internal/legacySaleCreateAdapter.ts");
    const legacy=source("src/lib/sales/legacyRouteSaleCreate.ts");
    const posCaller=source("src/apps/pos/application/createSale.ts");
    for(const v of [pos,legacy]){
      expect(v).toContain("await stageVoucherOnNewSale(transaction, {");
      expect(v).toContain("trustedTenantId: input.tenantId");
      expect(v).toContain("trustedBranchId: branchId");
      expect(v).toContain("trustedClientId: clientId");
      expect(v).toContain("invoiceId: newInvID");
      expect(v.indexOf("await stageVoucherOnNewSale")).toBeLessThan(v.lastIndexOf("return { invID: newInvID"));
    }
    expect(api).toContain("tenantId: String(sessionUser.TenantId)");
    expect(api).toContain("cutClubVoucherCode:");
    expect(api).toContain("process.env[STAGING_VOUCHER_INVOICE_FLAG]");
    expect(posCaller.indexOf("executeLegacySaleCreateTransaction")).toBeLessThan(posCaller.indexOf("await transaction.commit()"));
    expect(legacy.indexOf("await stageVoucherOnNewSale")).toBeLessThan(legacy.indexOf("await transaction.commit()"));
  });
  it("rejects another customer's, used, multi-unit, foreign-salon, expired or corrupt vouchers", () => {
    const current = new Date("2026-11-18T12:00:00Z").getTime();
    const good = {
      InventoryID:1, ItemID:17, ClientID:42, Quantity:1,
      Status:"ACTIVE", UsedInvID:null, ExpiresAt:null,
      ItemType:"FREE_SERVICE", ServiceID:null, SalonID:null,
    };
    expect(eligibleStagingVoucher(good,42,current)).toBe(true);
    expect(eligibleStagingVoucher(good,43,current)).toBe(false);
    expect(eligibleStagingVoucher({...good,Quantity:2},42,current)).toBe(false);
    expect(eligibleStagingVoucher({...good,Status:"USED"},42,current)).toBe(false);
    expect(eligibleStagingVoucher({...good,UsedInvID:55},42,current)).toBe(false);
    expect(eligibleStagingVoucher({...good,SalonID:3},42,current)).toBe(false);
    expect(eligibleStagingVoucher({...good,ItemType:"DISCOUNT_AMOUNT"},42,current)).toBe(false);
    expect(eligibleStagingVoucher({...good,ExpiresAt:new Date(current-1000)},42,current)).toBe(false);
    expect(eligibleStagingVoucher({...good,ExpiresAt:new Date("invalid")},42,current)).toBe(false);
  });
  it("staged invoice benefit must be a SINGLE full-value free service, never a manager-only 0-priced line", () => {
    const good={ProID:11,SPrice:200,SPriceAfterDis:0,Qty:1};
    expect(eligibleStagingInvoiceBenefit([good])).toBe(true);
    expect(eligibleStagingInvoiceBenefit([])).toBe(false);
    expect(eligibleStagingInvoiceBenefit([good,good])).toBe(false);
    expect(eligibleStagingInvoiceBenefit([{...good,SPrice:0}])).toBe(false);
    expect(eligibleStagingInvoiceBenefit([{...good,SPriceAfterDis:100}])).toBe(false);
    expect(eligibleStagingInvoiceBenefit([{...good,Qty:2}])).toBe(false);
    expect(eligibleStagingInvoiceBenefit([{...good,SPrice:Number.NaN}])).toBe(false);
  });

  it("voucher use proves exactly one positive original-price line with zero final price", () => {
    const src=source("src/lib/cut-club/stagingInvoiceClaim.ts");
    expect(src).toContain("eligibleStagingInvoiceBenefit(lines.recordset)");
    expect(src).toContain("eligibleStagingVoucher(voucher, input.trustedClientId, Date.now())");
    expect(src).toContain("ci.Status, ci.UsedInvID");
    expect(src).toContain("VoucherCode");
    expect(src).toContain("INSERT INTO dbo.CutClubVoucherInvoiceClaim");
    expect(src).toContain("AND UsedInvID IS NULL");
    expect(src).toContain("INSERT INTO dbo.TblInventoryUsageLog");
    expect(src).toContain("CUT_CLUB_CLAIM_USAGE_LOG_FAILED");
  });
  it("audited invoice edits fail closed and deletions reverse claim and voucher within same tx", () => {
    const route=source("src/app/api/sales/[id]/route.ts");
    const src=source("src/lib/cut-club/stagingInvoiceClaim.ts");
    expect(route).toContain("await denyEditOfStagingClaimedSale(transaction, invID)");
    expect(route).toContain("await reverseStagingClaimBeforeSaleDeletion(transaction, {");
    expect(route).toContain("return isPosPortEnabled()");
    expect(src).toContain("CUT_CLUB_CLAIMED_INVOICE_REQUIRES_CANCEL_REISSUE");
    expect(src).toContain("Status=N'REVERSED'");
    expect(src).toContain("UsedInvID=NULL");
    expect(src).toContain("CUT_CLUB_REVERSE_VOUCHER_STATE_MISMATCH");
    expect(src).toContain("CUT_CLUB_REVERSAL_WRITE_DISABLED");
  });
  it("staging migration refuses last132 and allows new claim after reversed history", () => {
    const ddl=source("docs/cut-club/sql/cashier-invoice-claim-staging-only.sql");
    expect(ddl).toContain("DB_NAME() <> N'last132_agent'");
    expect(ddl).toContain("SUSER_SNAME() <> N'drvo_agent'");
    expect(ddl).toContain("WHERE Status = N'APPLIED'");
    expect(ddl).toContain("CONSTRAINT CK_CutClubVoucherInvoiceClaim_Status");
    expect(ddl).toContain("REVERSED");
    expect(ddl).not.toMatch(/\bUSE\s+(last132|master)\b/i);
  });
});

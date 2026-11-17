import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  allowCashierConsume,
  validCashierScope,
  CASHIER_REDEEM_FLAG,
} from "@/lib/cut-club/cashierVoucher";

const scope = {
  tenantId: "c9413a3e-dc87-4a70-bc6e-d00d76f9066b",
  activeBranchId: 7,
  legacySalonId: 15,
  staffUserId: 11,
};
function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("CUT CLUB 2.0 cashier voucher and invoice privacy gates", () => {
  it("requires authoritative tenant, staff, and valid branch (never a caller clientId)", () => {
    expect(validCashierScope(scope)).toBe(true);
    for (const invalid of [
      { ...scope, tenantId: "cut-salon" },
      { ...scope, staffUserId: 0 },
      { ...scope, activeBranchId: 0 },
      { ...scope, legacySalonId: 0 },
      { ...scope, activeBranchId: 1.5 },
      { ...scope, activeBranchId: -2 },
    ]) expect(validCashierScope(invalid)).toBe(false);
    expect(allowCashierConsume({
      featureEnabled: false, scope, code: "CUT-ABCD123456", invoiceId: 99,
    })).toBe(false);
    expect(allowCashierConsume({
      featureEnabled: true, scope, code: "CUT-ABCD123456", invoiceId: 99,
    })).toBe(true);
  });

  it("denies missing invoice, invalid code and any unapproved feature flag", () => {
    for (const invoiceId of [null, undefined, 0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1]) {
      expect(allowCashierConsume({
        featureEnabled: true, scope, code: "CUT-ABCD123456", invoiceId,
      })).toBe(false);
    }
    for (const code of ["", "123", "clientId=1", "foo bar", "foo?x=1", "a".repeat(101)]) {
      expect(allowCashierConsume({
        featureEnabled: true, scope, code, invoiceId: 22,
      })).toBe(false);
    }
    expect(CASHIER_REDEEM_FLAG).toBe("CUT_CLUB_CASHIER_V2_REDEEM_ENABLED");
  });

  it("staff lookup requires session, operable active branch, private cache and scoped SQL", () => {
    const route = source("src/app/api/pos/cut-club/vouchers/route.ts");
    const engine = source("src/lib/cut-club/cashierVoucher.ts");
    expect(route).toContain("CUT_CLUB_CASHIER_V2_READ_ENABLED");
    expect(route).toContain("authenticate()");
    expect(route).toContain("validateUserBranchAccess");
    expect(route).toContain("branch.canOperate");
    expect(route).toContain("no-store");
    expect(engine).toContain("c.TenantId=@tenantId");
    expect(engine).toContain("si.SalonID=@legacySalonId");
    expect(engine).toContain("WHERE ci.VoucherCode=@code");
    expect(engine).not.toContain("Access-Control-Allow-Origin");
    expect(route).not.toContain("Access-Control-Allow-Origin");
  });

  it("redemption requires same-client saved sales invoice and actual free service effect", () => {
    const route = source("src/app/api/pos/cut-club/redeem/route.ts");
    const engine = source("src/lib/cut-club/cashierVoucher.ts");
    expect(route).toContain("CASHER_CANONICAL_ORIGIN");
    expect(route).toContain('req.headers.get("origin")');
    expect(route).toContain('req.headers.get("sec-fetch-site")');
    expect(route).toContain("same-origin");
    expect(route).toContain("validateUserBranchAccess");
    expect(route).toContain("branch.canOperate");
    expect(engine).toContain("sql.ISOLATION_LEVEL.SERIALIZABLE");
    expect(engine).toContain("WITH (UPDLOCK, HOLDLOCK)");
    expect(engine).toContain("h.invType=N'مبيعات'");
    expect(engine).toContain("h.BranchID=@branchId AND h.ClientID=@clientId");
    expect(engine).toContain('v.ItemType !== "FREE_SERVICE"');
    expect(engine).toContain("d.SPriceAfterDis=0");
    expect(engine).toContain("d.Qty>0");
    expect(engine).toContain("Status=N'ACTIVE'");
    expect(engine).toContain("UsedInvID=@invoiceId");
    expect(engine).toContain("INSERT INTO dbo.TblInventoryUsageLog");
    expect(engine).toContain("await tx.rollback()");
    expect(engine).toContain("v.UsedInvID !== input.invoiceId");
  });

  it("legacy pre-invoice one-click redemption path is quarantined, not used by modal", () => {
    const route = source("src/app/api/pos/client-inventory/use/route.ts");
    const modal = source("src/components/pos/ClientVouchersModal.tsx");
    expect(route).toContain('status: 410');
    expect(route).toContain("LEGACY_VOUCHER_USE_DISABLED");
    expect(route).not.toContain("useInventoryItem(");
    expect(modal).not.toContain('fetch(\'/api/pos/client-inventory/use\'');
    expect(modal).not.toContain("handleUse(v)");
    expect(modal).toContain("/cashier/cut-club");
    expect(modal).toContain("الفاتورة");
  });

  it("legacy cashier voucher scan is tenant-bound; phone matches are unambiguous", () => {
    const legacy = source("src/app/api/pos/voucher/route.ts");
    const lookupPhone = source("src/app/api/pos/client-inventory-by-phone/route.ts");
    expect(legacy).toContain("c.TenantId = @tenantId");
    expect(legacy).toContain("si.SalonID = @legacySalonId");
    expect(legacy).not.toContain('"Access-Control-Allow-Origin": "*"');
    expect(lookupPhone).toContain("SELECT TOP (2) ClientID, Name");
    expect(lookupPhone).toContain("clientResult.recordset.length !== 1");
  });

  it("cashier UI never optimistically marks voucher used before committed server receipt", () => {
    const ui = source("src/app/cashier/cut-club/CashierCutClubClient.tsx");
    expect(ui).toContain('if (r.ok && data.ok)');
    expect(ui).toContain('setVoucher({ ...voucher, status: "USED", usable: false })');
    expect(ui).toContain("احفظ الفاتورة");
    expect(ui).toContain("redemptionEnabled");
    expect(ui).toContain("readEnabled");
    expect(ui).toContain('credentials: "same-origin"');
  });
});

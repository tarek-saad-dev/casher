import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("CUT CLUB cashier branch/tenant voucher compatibility", () => {
  it("checks voucher service quantity before consuming whole inventory row", () => {
    const cashier = source("src/lib/cut-club/cashierVoucher.ts");
    expect(cashier).toContain("ci.Quantity");
    expect(cashier).toContain("v.Quantity !== 1");
    expect(cashier).toContain("AND Quantity=1");
    expect(cashier).toContain("UsedInvID=@invoiceId");
    expect(cashier).toContain("sql.ISOLATION_LEVEL.SERIALIZABLE");
    expect(cashier).toContain("dbo.TblInventoryUsageLog");
    expect(cashier).toContain("InvID, BookingID, ActionType, UsedAt, Notes");
    expect(cashier).toContain("@invoiceId, NULL, N'USED'");
  });

  it("clears old invoice when cashier scans another voucher", () => {
    const ui = source("src/app/cashier/cut-club/CashierCutClubClient.tsx");
    expect(ui).toContain('setVoucher(null); setInvoiceId("");');
    expect(ui).toContain("redemptionEnabled");
    expect(ui).toContain('if (r.ok && data.ok)');
  });

  it("POS inventory source enforces the real branch-to-SalonID scope in SQL, not client filtering", () => {
    const src = source("src/lib/store/inventory.service.ts");
    expect(src).toContain("legacySalonId?: number");
    expect(src).toContain("(si.SalonID IS NULL OR si.SalonID = @legacySalonId)");
    expect(src).toContain('request.input("legacySalonId", sql.Int, legacySalonId)');
    expect(src).not.toContain("localStorage");
  });

  it("staff POS list endpoints cannot read other branches or tenants by just a client ID/phone", () => {
    for (const name of ["src/app/api/pos/client-inventory/route.ts",
                        "src/app/api/pos/client-inventory-by-phone/route.ts"]) {
      const src = source(name);
      expect(src).toContain("authenticate()");
      expect(src).toContain("validateUserBranchAccess");
      expect(src).toContain("access.canOperate");
      expect(src).toContain("resolveTrustedLegacySalonId");
      expect(src).toContain("getClientInventory(clientId, \"ACTIVE\", legacySalonId)");
      expect(src).toContain("TenantId = @tenantId");
      expect(src).not.toContain('"Access-Control-Allow-Origin": "*"');
    }
    const byId = source("src/app/api/pos/client-inventory/route.ts");
    expect(byId).toContain('!Number.isSafeInteger(clientId)');
    expect(byId).toContain("clientResult.recordset.length !== 1");
    const byPhone = source("src/app/api/pos/client-inventory-by-phone/route.ts");
    expect(byPhone).toContain('!/^01[0-9]{9}$/.test(phone)');
    expect(byPhone).toContain("SELECT TOP (2) ClientID, Name");
    expect(byPhone).toContain("clientResult.recordset.length !== 1");
  });
});

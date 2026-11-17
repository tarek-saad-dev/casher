import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  approvedCutClubServiceId,
  verifyApprovedCutClubService,
} from "@/lib/cut-club/reviewedServiceEntitlements";

const tenant = "413d433e-f36b-1410-8820-009ec495c7e1";
const other = "18cb423e-f36b-1410-8822-009ec495c7e1";
const approved = JSON.stringify({
  [tenant + ":15"]: 39,
  [tenant + ":16"]: 22,
  [tenant + ":18"]: 9,
  // Item 17 (Basic SkinCare) deliberately NOT approved: 11 vs 29 unresolved.
});
const item = (id: number, map=approved, stored: number|null=null, t=tenant) =>
  approvedCutClubServiceId({
    trustedTenantId: t, rewardItemId: id,
    dbServiceId: stored, approvalJson: map,
  });
const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("CUT CLUB operator-approved ServiceID binding (live data is NOT approval)", () => {
  it("does not infer services from four old reward names or Coins prices", () => {
    expect(item(15)).toBe(39);
    expect(item(16)).toBe(22);
    expect(item(18)).toBe(9);
    expect(item(17)).toBeNull();
    expect(item(17, "")).toBeNull();
    expect(item(15, "{}")).toBeNull();
  });

  it("fails closed on wrong tenant, ID, stale DB mapping, and invalid map", () => {
    expect(item(15, approved, null, other)).toBeNull();
    expect(item(15, approved, 39)).toBe(39);
    expect(item(15, approved, 2092)).toBeNull();
    expect(item(15, approved, 0)).toBeNull();
    expect(item(15, approved, -1)).toBeNull();
    expect(item(0)).toBeNull();
    for (const map of [
      "{broken", "[]", '"hello"', '{"*:15":39}',
      JSON.stringify({ [tenant+":15"]: "39" }),
      JSON.stringify({ [tenant+":15"]: -1 }),
      JSON.stringify({ [tenant+":15"]: 39, [tenant.toUpperCase()+":15"]: 2092 }),
    ]) expect(item(15, map)).toBeNull();
  });

  it("is not enough to configure a number: service must actually exist, active, same tenant", async () => {
    const input = {
      trustedTenantId: tenant, rewardItemId: 15,
      dbServiceId: null, approvalJson: approved,
    };
    expect(await verifyApprovedCutClubService({
      ...input, isActiveTenantService: async (t, service) => t===tenant && service===39,
    })).toBe(39);
    expect(await verifyApprovedCutClubService({
      ...input, isActiveTenantService: async () => false,
    })).toBeNull();
    expect(await verifyApprovedCutClubService({
      ...input, isActiveTenantService: async () => { throw Error("DB down"); },
    })).toBeNull();
    let called = false;
    expect(await verifyApprovedCutClubService({
      ...input, rewardItemId: 17,
      isActiveTenantService: async () => { called = true; return true; },
    })).toBeNull();
    expect(called).toBe(false);
  });

  it("cashier lookup and redemption use same reviewed service, with real tenant-bound TblPro", () => {
    const cashier = source("src/lib/cut-club/cashierVoucher.ts");
    expect(cashier).toContain("verifyApprovedCutClubService");
    expect(cashier).toContain("ci.ItemID");
    expect(cashier).toContain("p.TenantId=@tenantId AND p.ProID=@serviceId");
    expect(cashier).toContain("p.isDeleted=0");
    expect(cashier).toContain("const serviceId = await verifiedServiceId(");
    expect(cashier).toContain('if (!validId(serviceId)) throw Error("CUT_CLUB_SERVICE_NOT_APPROVED")');
    expect(cashier).toContain('.input("serviceId", sql.Int, serviceId)');
    expect(cashier).not.toContain(".input(\"serviceId\", sql.Int, v.ServiceID)");
  });

  it("zero-priced invoice lines alone do NOT prove voucher usage: unique claim required", () => {
    const cashier = source("src/lib/cut-club/cashierVoucher.ts");
    expect(cashier).toContain("dbo.CutClubVoucherInvoiceClaim");
    expect(cashier).toContain("cl.InventoryID=@inventoryId");
    expect(cashier).toContain("cl.TenantId=@tenantId");
    expect(cashier).toContain("cl.ClientID=@clientId");
    expect(cashier).toContain("cl.BranchID=@branchId");
    expect(cashier).toContain("cl.InvID=@invoiceId");
    expect(cashier).toContain("cl.ServiceID=@serviceId");
    expect(cashier).toContain("cl.Status=N'APPLIED'");
    expect(cashier).toContain("CUT_CLUB_INVOICE_CLAIM_REQUIRED");
    const claimOffset = cashier.indexOf("CUT_CLUB_INVOICE_CLAIM_REQUIRED");
    const voucherUpdateOffset = cashier.indexOf("UPDATE dbo.TblClientInventory");
    expect(claimOffset).toBeGreaterThan(0);
    expect(voucherUpdateOffset).toBeGreaterThan(claimOffset);
    expect(cashier).toContain("await tx.rollback()");
  });
});

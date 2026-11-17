import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isCutClubCashierBranchApproved } from "@/lib/cut-club/cashierProductionBranchPolicy";
import { validCashierScope } from "@/lib/cut-club/cashierVoucher";
import { resolveTrustedLegacySalonId } from "@/lib/cut-club/cashierSalonMap";

const prodTenant = "413d433e-f36b-1410-8820-009ec495c7e1";
const demoTenant = "18cb423e-f36b-1410-8822-009ec495c7e1";
const operatorApproved = JSON.stringify([prodTenant+":1", prodTenant+":3"]);
const ok = (branchId: number, tenantId=prodTenant, approved=operatorApproved) =>
  isCutClubCashierBranchApproved({
    trustedTenantId: tenantId, trustedBranchId: branchId, allowlistJson: approved,
  });
const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("2026-11-17 last132 read-only branch evidence / CUT CLUB release gate", () => {
  it("Gleem (1) and Camp Caesar (3) permitted ONLY with explicit operator approval", () => {
    expect(ok(1)).toBe(true);
    expect(ok(3)).toBe(true);
    // Same tenant PH1GTEST (2) is ACTIVE in DB; this is not launch approval.
    expect(ok(2)).toBe(false);
    expect(ok(8,demoTenant)).toBe(false);
    expect(ok(9,demoTenant)).toBe(false);
    expect(ok(1,prodTenant,"[]")).toBe(false);
    expect(ok(3,prodTenant,"")).toBe(false);
  });
  it("denies guessed/wildcard/malformed/untrusted branch policies", () => {
    for(const s of [
      "invalid", "{}", '["*:1"]',
      JSON.stringify([prodTenant+":0"]), JSON.stringify([prodTenant+":-1"]),
      JSON.stringify([prodTenant+":1","*:3"]),
    ]) expect(ok(1,prodTenant,s)).toBe(false);
    expect(ok(0)).toBe(false);
    expect(ok(-1)).toBe(false);
    expect(ok(1,"not-a-uuid")).toBe(false);
    expect(ok(1,demoTenant)).toBe(false);
  });
  it("ALL four rewards with NULL SalonID do not justify manufacturing numerical mapping", () => {
    expect(resolveTrustedLegacySalonId({
      trustedTenantId: prodTenant, trustedBranchId: 1, mappingJson: "{}",
    })).toBeNull();
    expect(validCashierScope({
      tenantId: prodTenant, activeBranchId: 1, legacySalonId: null, staffUserId: 17,
    })).toBe(true);
    expect(validCashierScope({
      tenantId: prodTenant, activeBranchId: 1, legacySalonId: 0, staffUserId: 17,
    })).toBe(false);
  });
  it("global rewards cannot weaken scoped-item SQL predicates or staff/tenant checks", () => {
    const routes=[
      "src/app/api/pos/cut-club/vouchers/route.ts",
      "src/app/api/pos/cut-club/redeem/route.ts",
      "src/app/api/pos/client-inventory/route.ts",
      "src/app/api/pos/client-inventory-by-phone/route.ts",
      "src/app/api/pos/voucher/route.ts",
    ];
    for(const file of routes){
      const content=source(file);
      expect(content).toContain("isCutClubCashierBranchApproved");
      expect(content).toContain("resolveTrustedLegacySalonId");
      expect(content).toContain("validateUserBranchAccess");
    }
    const cashier=source("src/lib/cut-club/cashierVoucher.ts");
    const legacy=source("src/lib/store/inventory.service.ts");
    expect(cashier).toContain("(si.SalonID IS NULL OR (@legacySalonId IS NOT NULL AND si.SalonID=@legacySalonId))");
    expect(legacy).toContain("(si.SalonID IS NULL OR (@legacySalonId IS NOT NULL AND si.SalonID = @legacySalonId))");
    expect(legacy).toContain("legacySalonId !== undefined");
  });
});

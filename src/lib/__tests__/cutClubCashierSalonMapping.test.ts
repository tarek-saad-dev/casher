import { describe, expect, it } from "vitest";
import { resolveTrustedLegacySalonId } from "@/lib/cut-club/cashierSalonMap";

const tenant = "c9413a3e-dc87-4a70-bc6e-d00d76f9066b";
const key = tenant + ":7";
const mappingJson = JSON.stringify({ [key]: 15, [tenant + ":8"]: 18 });

describe("CUT CLUB cashier trusted Tenant+Branch -> legacy SalonID mapping", () => {
  it("requires explicit approved distinct mapping rather than equating branch and salon IDs", () => {
    expect(resolveTrustedLegacySalonId({
      trustedTenantId: tenant, trustedBranchId: 7, mappingJson,
    })).toBe(15);
    expect(resolveTrustedLegacySalonId({
      trustedTenantId: tenant, trustedBranchId: 8, mappingJson,
    })).toBe(18);
    expect(resolveTrustedLegacySalonId({
      trustedTenantId: tenant, trustedBranchId: 9, mappingJson,
    })).toBeNull();
  });
  it("fails closed with unknown tenant, invalid/untrusted branch, wrong data or missing mapping", () => {
    for (const config of [
      { trustedTenantId: tenant, trustedBranchId: 0, mappingJson },
      { trustedTenantId: "cut-salon", trustedBranchId: 7, mappingJson },
      { trustedTenantId: tenant, trustedBranchId: 7, mappingJson: "{}" },
      { trustedTenantId: tenant, trustedBranchId: 7, mappingJson: "{broken" },
      { trustedTenantId: tenant, trustedBranchId: 7, mappingJson: JSON.stringify({ [key]: "7" }) },
      { trustedTenantId: tenant, trustedBranchId: 7, mappingJson: JSON.stringify({ [key]: 0 }) },
      { trustedTenantId: tenant, trustedBranchId: 7, mappingJson: JSON.stringify({ [key]: 2.5 }) },
    ]) expect(resolveTrustedLegacySalonId(config)).toBeNull();
  });
});

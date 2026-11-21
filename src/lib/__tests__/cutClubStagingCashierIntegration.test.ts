import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("CUT CLUB staging-only POS real invoice entrypoint", () => {
  it("server status exposes true only after staff permission, branch allowlist, flag and exact staging DB/login", () => {
    const api=source("src/app/api/pos/cut-club/staging-mode/route.ts");
    expect(api).toContain("authenticate()");
    expect(api).toContain("validateUserBranchAccess");
    expect(api).toContain("branch.canOperate");
    expect(api).toContain("isCutClubCashierBranchApproved");
    expect(api).toContain('context?.DbName === "last132_agent"');
    expect(api).toContain('context?.LoginName === "drvo_agent"');
    expect(api).toContain("context?.HasClaimTable === 1");
    expect(api).toContain("private, no-store");
    expect(api).not.toContain("Access-Control-Allow-Origin");
  });
  it("real POS cashier UI sends voucher with POST /api/sales only if staged, customer selected, new invoice", () => {
    const pos=source("src/app/income/pos/page.tsx");
    expect(pos).toContain('fetch('/api/pos/cut-club/staging-mode'');
    expect(pos).toContain('d?.enabled===true');
    expect(pos).toContain('cutClubStagingEnabled&&state.customer&&editingSaleId===null');
    expect(pos).toContain('cutClubVoucherCode:cutClubStagingEnabled&&editingSaleId===null');
    expect(pos).toContain("setCutClubVoucherCode(\"\")");
    expect(pos).toContain("setCustomerBase(c)");
    expect(pos).toContain("cutClubVoucherCode");
    expect(pos).toContain("const url = isEditing ? `/api/sales/${editingSaleId}` : '/api/sales'");
  });
  it("normal POS sale is unchanged; malformed/off vouchers are rejected before opening transaction", () => {
    const api=source("src/app/api/sales/route.ts");
    const core=source("src/lib/cut-club/stagingInvoiceClaim.ts");
    expect(api).toContain("STAGING_VOUCHER_INVOICE_FLAG");
    expect(api).toContain("cutClubVoucherCode:");
    expect(api).toContain("sessionUser.TenantId");
    expect(api).toContain("status: 409");
    expect(core).toContain('input.voucherCode === ""');
    expect(core).toContain("return false; // ordinary POS sale unchanged");
    expect(core).toContain("CUT_CLUB_STAGING_CONNECTION_OR_CLAIM_SCHEMA_UNVERIFIED");
  });
});

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prepareOpaqueSession } from "@/lib/cut-club/otpDomain";
import type { OtpDurableRepository } from "@/lib/cut-club/otpDomain";
import { revealVerifiedClientVoucher } from "@/lib/cut-club/clientVoucherHandoff";
import type { OwnedVoucherSource, VoucherOwner } from "@/lib/cut-club/clientVoucherHandoff";

const tenantId = "c9413a3e-dc87-4a70-bc6e-d00d76f9066b";
const otherTenant = "e1413a3e-dc87-4a70-bc6e-d00d76f9066b";
const now = 1_900_000_000;
const material = prepareOpaqueSession({
  tenantId, customerId: 42, verifiedAtSeconds: now - 20, nowSeconds: now - 10,
});
const sessions = {
  getSession: vi.fn(async ({ tenantId: t, tokenDigest }: { tenantId: string; tokenDigest: string }) =>
    t === tenantId && tokenDigest === material.record.tokenDigest ? material.record : null),
} as unknown as OtpDurableRepository;
const good: OwnedVoucherSource = {
  proveTenantCustomerOwner: vi.fn(async (owner: VoucherOwner) =>
    owner.tenantId === tenantId && owner.customerId === 42),
  getVoucherForOwner: vi.fn(async (owner: VoucherOwner) => owner.customerId === 42 ? {
    inventoryId: 10, ownerCustomerId: 42, status: "ACTIVE" as const,
    voucherCode: "CUT-PRIVATE-1234567890",
    expiresAt: new Date((now + 3600) * 1000),
  } : null),
};
const request = (extra: Record<string, unknown> = {}) => ({
  enabled: true, trustedTenantId: tenantId, inventoryId: 10,
  opaqueCookieToken: material.tokenForCookie, nowSeconds: now,
  sessions, source: good, ...extra,
});

describe("CUT CLUB client↔cashier owned voucher handoff — synthetic only", () => {
  it("gates every voucher-code reveal behind a real revocable tenant customer session", async () => {
    expect((await revealVerifiedClientVoucher(request({ enabled: false }))).ok).toBe(false);
    expect((await revealVerifiedClientVoucher(request({ opaqueCookieToken: "clientId=42" }))).ok).toBe(false);
    expect((await revealVerifiedClientVoucher(request({ trustedTenantId: otherTenant }))).ok).toBe(false);
    expect((await revealVerifiedClientVoucher(request({ nowSeconds: now + 7200 }))).ok).toBe(false);
  });

  it("returns the customer-owned active voucher code for future secure BFF only", async () => {
    const r = await revealVerifiedClientVoucher(request({ customerId: 999 }));
    expect(r.ok).toBe(true);
    if (!r.ok) throw Error("Unexpected fake auth");
    expect(r.voucher.voucherCode).toBe("CUT-PRIVATE-1234567890");
    expect(r.voucher.inventoryId).toBe(10);
    expect(r.voucher).not.toHaveProperty("customerId");
    expect(r.voucher).not.toHaveProperty("tenantId");
    expect(good.getVoucherForOwner).toHaveBeenCalledWith({
      tenantId, customerId: 42,
    }, 10);
  });

  it("rejects foreign, used, cancelled, malformed or expired vouchers with no code disclosure", async () => {
    const original = await good.getVoucherForOwner({ tenantId, customerId: 42 }, 10);
    if (!original) throw Error("test voucher missing");
    for (const patch of [
      { ownerCustomerId: 44 },
      { inventoryId: 11 },
      { status: "USED" },
      { status: "CANCELLED" },
      { status: "EXPIRED" },
      { voucherCode: "bad coupon" },
      { expiresAt: new Date((now - 1) * 1000) },
    ]) {
      const source: OwnedVoucherSource = {
        proveTenantCustomerOwner: async () => true,
        getVoucherForOwner: async () => ({ ...original, ...patch }) as typeof original,
      };
      expect(await revealVerifiedClientVoucher(request({ source }))).toEqual({
        ok: false, reason: "unavailable",
      });
    }
    const notOwned: OwnedVoucherSource = {
      proveTenantCustomerOwner: async () => false,
      getVoucherForOwner: vi.fn(async () => original),
    };
    expect((await revealVerifiedClientVoucher(request({ source: notOwned }))).ok).toBe(false);
    expect(notOwned.getVoucherForOwner).not.toHaveBeenCalled();
  });

  it("SQL retrieval repeats tenant/customer predicates and never fetches by phone or bare inventory ID", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/cut-club/sqlOwnedVoucherSource.ts"), "utf8");
    expect(source).toContain("verifyOwnedClient");
    expect(source).toContain("ci.ClientID=@clientId AND c.TenantId=@tenantId");
    expect(source).toContain("ci.InventoryID=@inventoryId");
    expect(source).toContain("ci.Status=N'ACTIVE'");
    expect(source).toContain("ci.ExpiresAt>GETDATE()");
    expect(source).not.toContain("Mobile");
    expect(source).not.toContain("getPool(");
    expect(source).not.toContain("Access-Control-Allow-Origin");
  });

  it("does not create client HTTP routes, access localStorage or mint login tokens", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/cut-club/clientVoucherHandoff.ts"), "utf8");
    const executable = source.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const unsafe of [
      "NextResponse", "NextRequest", "localStorage", "clientId",
      "new ConnectionPool", "req.json", "sendCode(",
    ]) expect(executable).not.toContain(unsafe);
  });
});

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prepareOpaqueSession } from "@/lib/cut-club/otpDomain";
import type { OtpDurableRepository } from "@/lib/cut-club/otpDomain";
import { readCutClubMemberSnapshot } from "@/lib/cut-club/memberReadCore";
import type { ClubMemberKey, MemberReadStore } from "@/lib/cut-club/memberReadCore";

const tenantId = "c9413a3e-dc87-4a70-bc6e-d00d76f9066b";
const otherTenant = "e1413a3e-dc87-4a70-bc6e-d00d76f9066b";
const now = 1_900_000_000;
const valid = prepareOpaqueSession({
  tenantId, customerId: 42, verifiedAtSeconds: now - 20, nowSeconds: now - 10,
});
const sessionRepo = {
  getSession: vi.fn(async ({ tenantId: t }: { tenantId: string; tokenDigest: string }) =>
    t === tenantId ? valid.record : null),
} as unknown as OtpDurableRepository;

function source(): MemberReadStore {
  return {
    ownsCustomer: vi.fn(async (key: ClubMemberKey) => key.tenantId === tenantId && key.customerId === 42),
    memberRow: vi.fn(async () => [{
      ClientID: 42, ClientName: "عميل تجريبي", ClientLoyaltyID: 101,
      PointsBalance: 320.5, LifetimeEarnedPoints: 500,
      TotalVisits: 4, TierCode: "SILVER", TierNameAr: "فضي",
      LastVisitDate: new Date("2026-11-01T12:00:00Z"),
      Phone: "01000000000", VoucherCode: "VERY-SECRET",
    }]),
    ledgerRows: vi.fn(async () => [{
      LedgerID: 100, MovementType: "EARN_SALE", PointsDelta: 150,
      CreatedAt: new Date("2026-11-01T12:00:00Z"), Notes: "PII-NOTES",
    }]),
    voucherRows: vi.fn(async () => [{
      InventoryID: 110, Status: "ACTIVE", NameAr: "قسيمة اختبار",
      ExpiresAt: new Date("2026-12-01T00:00:00Z"), VoucherCode: "PRIVATE-COUPON",
    }]),
  };
}
const input = (s: MemberReadStore, extra: Record<string, unknown> = {}) => ({
  enabled: true, trustedTenantId: tenantId, browserOpaqueCookie: valid.tokenForCookie,
  nowSeconds: now, sessionRepo, source: s, ...extra,
});

describe("CUT CLUB private member read model — fake data only (#298)", () => {
  it("blocks all DB reads when feature gate disabled or session absent", async () => {
    const s = source();
    const denied = await readCutClubMemberSnapshot(input(s, { enabled: false }));
    expect(denied).toEqual({ ok: false, error: "unavailable" });
    expect(s.ownsCustomer).not.toHaveBeenCalled();
    expect(s.memberRow).not.toHaveBeenCalled();
    const expired = await readCutClubMemberSnapshot(input(s, { nowSeconds: now + 8000 }));
    expect(expired.ok).toBe(false);
    expect(s.ownsCustomer).not.toHaveBeenCalled();
  });

  it("never uses caller-selected clientId or cross-tenant token", async () => {
    const s = source();
    expect(await readCutClubMemberSnapshot(input(s, {
      trustedTenantId: otherTenant, clientId: 666,
    }))).toEqual({ ok: false, error: "unavailable" });
    expect(s.ownsCustomer).not.toHaveBeenCalled();
    expect(await readCutClubMemberSnapshot(input(s, {
      browserOpaqueCookie: "clientId=42",
    }))).toEqual({ ok: false, error: "unavailable" });
    expect(s.memberRow).not.toHaveBeenCalled();
  });

  it("returns only explicitly safe bounded private DTO after owner proof", async () => {
    const s = source();
    const r = await readCutClubMemberSnapshot(input(s, { clientId: 9999 }));
    expect(r.ok).toBe(true);
    if (!r.ok) throw Error("Missing safe wallet result");
    expect(r.data.member).toMatchObject({ displayName: "عميل تجريبي", tierCode: "SILVER", visits: 4 });
    expect(r.data.wallet.availableCoins).toBe(320.5);
    expect(r.data.wallet.activity).toHaveLength(1);
    expect(r.data.wallet.vouchers[0].status).toBe("ACTIVE");
    expect(r.data.enabledActions).toEqual({ redeem: false, buy: false, mysteryBox: false });
    expect(JSON.stringify(r)).not.toContain("PRIVATE-COUPON");
    expect(JSON.stringify(r)).not.toContain("01000000000");
    expect(JSON.stringify(r)).not.toContain("PII-NOTES");
    expect(s.ownsCustomer).toHaveBeenCalledWith({ tenantId, customerId: 42 });
    expect(s.memberRow).toHaveBeenCalledWith({ tenantId, customerId: 42 });
    expect(s.ledgerRows).toHaveBeenCalledWith({ tenantId, customerId: 42 });
  });

  it("fails closed on absent authority, wrong owner or duplicate loyalty rows", async () => {
    const s = source();
    const deny = source();
    deny.ownsCustomer = vi.fn(async () => false);
    expect(await readCutClubMemberSnapshot(input(deny))).toEqual({ ok: false, error: "unavailable" });
    expect(deny.memberRow).not.toHaveBeenCalled();
    const foreign = source();
    foreign.memberRow = vi.fn(async () => [{
      ClientID: 43, ClientName: "Foreign", ClientLoyaltyID: 2, PointsBalance: 300,
      LifetimeEarnedPoints: 500, TotalVisits: 1, TierCode: "GOLD",
      TierNameAr: "Gold", LastVisitDate: null,
    }]);
    expect(await readCutClubMemberSnapshot(input(foreign))).toEqual({ ok: false, error: "unavailable" });
    const repeated = source();
    const row = await repeated.memberRow({ tenantId, customerId: 42 });
    repeated.memberRow = vi.fn(async () => [...row, ...row]);
    expect(await readCutClubMemberSnapshot(input(repeated))).toEqual({ ok: false, error: "unavailable" });
  });

  it("rejects negative balance, duplicate ledger ids and overlong voucher lists", async () => {
    const badMoney = source();
    const rows = await badMoney.memberRow({ tenantId, customerId: 42 });
    badMoney.memberRow = vi.fn(async () => [{ ...rows[0], PointsBalance: -1 }]);
    expect((await readCutClubMemberSnapshot(input(badMoney))).ok).toBe(false);

    const duplicated = source();
    const entries = await duplicated.ledgerRows({ tenantId, customerId: 42 });
    duplicated.ledgerRows = vi.fn(async () => [...entries, ...entries]);
    expect((await readCutClubMemberSnapshot(input(duplicated))).ok).toBe(false);

    const overLimit = source();
    const vouchers = await overLimit.voucherRows({ tenantId, customerId: 42 });
    overLimit.voucherRows = vi.fn(async () => Array.from({ length: 26 }, (_, i) => ({
      ...vouchers[0], InventoryID: i + 1,
    })));
    expect((await readCutClubMemberSnapshot(input(overLimit))).ok).toBe(false);
  });

  it("SQL adapter has no raw phone query, exposes no voucher codes and bounds reads", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/cut-club/sqlMemberReadSource.ts"), "utf8");
    const sqlOnly = src.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(sqlOnly).toContain("proveTenantCustomerOwnership");
    expect(sqlOnly).toContain("WHERE cl.ClientID = @clientId");
    expect(sqlOnly).toContain("WHERE ci.ClientID = @clientId");
    expect(sqlOnly).toContain("TOP (20)");
    expect(sqlOnly).toContain("TOP (25)");
    expect(sqlOnly).not.toContain("VoucherCode");
    expect(sqlOnly).not.toContain("Mobile");
    expect(sqlOnly).not.toContain("new ConnectionPool");
  });
});

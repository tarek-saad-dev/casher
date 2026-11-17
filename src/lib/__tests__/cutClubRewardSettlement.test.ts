import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prepareOpaqueSession } from "@/lib/cut-club/otpDomain";
import type { OtpDurableRepository } from "@/lib/cut-club/otpDomain";
import { purchaseRewardWithVerifiedSession } from "@/lib/cut-club/rewardSettlement";
import type {
  PurchaseReceipt, RewardOwner, RewardPurchasePort,
  RewardPurchaseTransaction, StoredPurchaseCommand,
} from "@/lib/cut-club/rewardSettlement";

const tenantId = "c9413a3e-dc87-4a70-bc6e-d00d76f9066b";
const otherTenant = "e1413a3e-dc87-4a70-bc6e-d00d76f9066b";
const now = 1_900_000_000;
const session = prepareOpaqueSession({ tenantId, customerId: 42, verifiedAtSeconds: now - 20, nowSeconds: now - 10 });
const sessionRepo = {
  getSession: vi.fn(async ({ tenantId: tenant }: { tenantId: string }) => tenant === tenantId ? session.record : null),
} as unknown as OtpDurableRepository;
const idempotencyKey = "SAME_REQUEST_KEY_XYZ_0001";

type MemoryState = {
  coins: number; stock: number; nextInventory: number;
  commands: Map<string, StoredPurchaseCommand>;
  ledger: readonly number[]; vouchers: readonly string[];
};
const initial = (): MemoryState => ({
  coins: 1000, stock: 1, nextInventory: 1,
  commands: new Map(), ledger: [], vouchers: [],
});
const clone = (s: MemoryState): MemoryState => ({
  ...s, commands: new Map(s.commands),
  ledger: [...s.ledger], vouchers: [...s.vouchers],
});
class FakeAtomicStore implements RewardPurchasePort {
  state: MemoryState = initial();
  attempts = 0;
  failLedger = false;
  rewardItemType = "FREE_SERVICE";
  rewardServiceId: number | null = 9;
  private tail: Promise<unknown> = Promise.resolve();
  async serializable<T>(work: (tx: RewardPurchaseTransaction) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      this.attempts++;
      const pending = clone(this.state);
      const ownerMatches = (owner: RewardOwner) =>
        owner.tenantId === tenantId && owner.customerId === 42 && owner.salonId === 7;
      const tx: RewardPurchaseTransaction = {
        async lockMember(owner) { return ownerMatches(owner); },
        async findCommand(owner, key) {
          return ownerMatches(owner) ? pending.commands.get(key) ?? null : null;
        },
        async findPublishedItem(owner, id) {
          if (!ownerMatches(owner) || id !== 11) return null;
          return { itemId: 11, priceCoins: 200, isActive: true,
            itemType: thisFake.rewardItemType, serviceId: thisFake.rewardServiceId,
            requiresTierRank: 1, unlimitedStock: false, expiresAfterDays: 30 };
        },
        async lockMemberBalance(owner) {
          return ownerMatches(owner) ? {
            clientLoyaltyId: 100, balanceCoins: pending.coins, tierRank: 2,
          } : null;
        },
        async reserveOneStock(owner, id) {
          if (!ownerMatches(owner) || id !== 11 || pending.stock <= 0) return false;
          pending.stock--;
          return true;
        },
        async debitCoins(owner, loyaltyId, amount) {
          if (!ownerMatches(owner) || loyaltyId !== 100 || pending.coins < amount) return null;
          const before = pending.coins;
          pending.coins -= amount;
          return { before, after: pending.coins };
        },
        async createLedger(owner, input) {
          if (thisFake.failLedger || !ownerMatches(owner) ||
              input.after !== pending.coins) return false;
          pending.ledger = [...pending.ledger, -input.priceCoins];
          return true;
        },
        async createOwnedVoucher(owner, input) {
          if (!ownerMatches(owner) || !input.voucherCode.startsWith("CUT-")) return null;
          pending.vouchers = [...pending.vouchers, input.voucherCode];
          return pending.nextInventory++;
        },
        async recordCommand(owner, key, receipt: PurchaseReceipt) {
          if (!ownerMatches(owner) || pending.commands.has(key)) return false;
          pending.commands.set(key, { itemId: receipt.itemId, receipt });
          return true;
        },
      };
      const thisFake = this;
      const result = await work(tx);
      this.state = pending; // commit only after every operation succeeds.
      return result;
    };
    const chained = this.tail.then(run);
    this.tail = chained.then(() => undefined, () => undefined);
    return chained;
  }
}
const request = (fake: FakeAtomicStore, opts: Record<string, unknown> = {}) => ({
  enabled: true, trustedTenantId: tenantId, trustedSalonId: 7,
  cookieToken: session.tokenForCookie, nowSeconds: now,
  itemId: 11, idempotencyKey, sessionRepo,
  verifyOwnedCustomerAndSalon: vi.fn(async (owner: RewardOwner) =>
    owner.tenantId === tenantId && owner.customerId === 42 && owner.salonId === 7),
  port: fake, ...opts,
});

describe("CUT CLUB V2 atomic idempotent reward purchase contract (#300)", () => {
  it("is completely OFF until verified session + account ownership are ready", async () => {
    const fake = new FakeAtomicStore();
    expect(await purchaseRewardWithVerifiedSession(request(fake, { enabled: false })))
      .toEqual({ ok: false, reason: "unavailable" });
    expect(await purchaseRewardWithVerifiedSession(request(fake, {
      trustedTenantId: otherTenant,
    }))).toEqual({ ok: false, reason: "unavailable" });
    expect(await purchaseRewardWithVerifiedSession(request(fake, {
      cookieToken: "clientId=42",
    }))).toEqual({ ok: false, reason: "unavailable" });
    expect(fake.attempts).toBe(0);
  });

  it("refuses active production-like free-service rewards without an actual ServiceID before any Coins spend", async () => {
    for (const missing of [null, 0, -1, 1.5]) {
      const fake = new FakeAtomicStore();
      fake.rewardServiceId = missing;
      const result = await purchaseRewardWithVerifiedSession(request(fake));
      expect(result.ok).toBe(false);
      expect(fake.state.coins).toBe(1000);
      expect(fake.state.stock).toBe(1);
      expect(fake.state.ledger).toHaveLength(0);
      expect(fake.state.vouchers).toHaveLength(0);
      expect(fake.state.commands.size).toBe(0);
    }
    const unsupported = new FakeAtomicStore();
    unsupported.rewardItemType = "DISCOUNT_AMOUNT";
    expect((await purchaseRewardWithVerifiedSession(request(unsupported))).ok).toBe(false);
    expect(unsupported.state.coins).toBe(1000);
    expect(unsupported.state.ledger).toHaveLength(0);
  });

  it("atomically spends Coins, decrements stock and issues one owned voucher", async () => {
    const fake = new FakeAtomicStore();
    const first = await purchaseRewardWithVerifiedSession(request(fake));
    expect(first.ok).toBe(true);
    if (!first.ok) throw Error("fake failure");
    expect(first.replayed).toBe(false);
    expect(first.receipt).toMatchObject({ itemId: 11, coinsCharged: 200, balanceAfter: 800, inventoryId: 1 });
    expect(first.receipt.voucherCode).toMatch(/^CUT-[A-F0-9]{40}$/);
    expect(fake.state.coins).toBe(800);
    expect(fake.state.stock).toBe(0);
    expect(fake.state.ledger).toEqual([-200]);
    expect(fake.state.vouchers).toHaveLength(1);
    expect(fake.state.commands.size).toBe(1);

    const replay = await purchaseRewardWithVerifiedSession(request(fake));
    expect(replay).toEqual({ ...first, replayed: true });
    expect(fake.state.ledger).toHaveLength(1);
    expect(fake.state.coins).toBe(800);
    expect(fake.state.vouchers).toHaveLength(1);
  });

  it("concurrent same-key submits settle only once and return identical receipt", async () => {
    const fake = new FakeAtomicStore();
    const [a, b] = await Promise.all([
      purchaseRewardWithVerifiedSession(request(fake)),
      purchaseRewardWithVerifiedSession(request(fake)),
    ]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) throw Error("fake failure");
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(a.receipt).toEqual(b.receipt);
    expect(fake.state.coins).toBe(800);
    expect(fake.state.stock).toBe(0);
    expect(fake.state.ledger).toHaveLength(1);
  });

  it("rolls back stock and Coins together on ledger failure or sold-out item", async () => {
    const fake = new FakeAtomicStore();
    fake.failLedger = true;
    expect((await purchaseRewardWithVerifiedSession(request(fake))).ok).toBe(false);
    expect(fake.state.coins).toBe(1000);
    expect(fake.state.stock).toBe(1);
    expect(fake.state.ledger).toHaveLength(0);
    expect(fake.state.vouchers).toHaveLength(0);
    fake.failLedger = false;
    fake.state.stock = 0;
    expect((await purchaseRewardWithVerifiedSession(request(fake))).ok).toBe(false);
    expect(fake.state.coins).toBe(1000);
    expect(fake.state.vouchers).toHaveLength(0);
  });

  it("fails on same key with different item and never reuses a voucher for another product", async () => {
    const fake = new FakeAtomicStore();
    expect((await purchaseRewardWithVerifiedSession(request(fake))).ok).toBe(true);
    expect((await purchaseRewardWithVerifiedSession(request(fake, { itemId: 12 }))).ok).toBe(false);
    expect(fake.state.commands.size).toBe(1);
    expect(fake.state.ledger).toHaveLength(1);
  });

  it("enforces schema and SQL transaction contract without executing production SQL", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/cut-club/sqlRewardPurchasePort.ts"), "utf8");
    const schema = readFileSync(resolve(process.cwd(), "docs/cut-club/sql/reward-command-staging.sql"), "utf8");
    expect(source).toContain("sql.ISOLATION_LEVEL.SERIALIZABLE");
    expect(source).toContain("sp_getapplock");
    expect(source).toContain("WHERE ClientID=@clientId");
    expect(source).toContain("PointsBalance>=@priceCoins");
    expect(source).toContain("StockQuantity > 0");
    expect(source).toContain("INSERT INTO dbo.CutClubRewardCommand");
    expect(source).not.toContain("getPool");
    expect(schema).toContain("DB_NAME() <> N'last132_agent'");
    expect(schema).toContain("SUSER_SNAME() <> N'drvo_agent'");
    expect(schema).toContain("PRIMARY KEY (TenantId, CustomerId, IdempotencyKey)");
    expect(schema).not.toMatch(/\bUSE\s+(?:last132|master)\b/i);
  });
});

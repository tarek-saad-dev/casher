import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { projectPublicRewardCatalog } from "@/lib/cut-club/publicRewardCatalog";

const row = () => ({
  itemId: 1, categoryId: 4,
  nameAr: "مكافأة تجريبية", nameEn: "Sample reward",
  priceCoins: 300, isActive: true, isFeatured: true,
  // Sensitive fields intentionally poison this input. None are publishable.
  clientId: 123456789, tenantId: "private-tenant-A", balance: 9876543,
  canAfford: true, remainingCoinsAfterPurchase: 900,
  stockQuantity: 1, minTierCode: "VIP_SECRET",
  voucherCode: "SECRET-VOUCHER-123", inventoryId: 97,
  phone: "01000000000", serviceId: 500, productId: 1000,
  expiresAfterDays: 30, value: 999,
  createdAt: "private-internal-timestamp",
});

describe("CUT CLUB browse-only public reward projection (#276)", () => {
  it("returns only explicitly publishable fields with purchases disabled", () => {
    const projected = projectPublicRewardCatalog([row()]);
    expect(projected).toEqual({
      mode: "browse_only",
      items: [{
        itemId: 1, categoryId: 4,
        nameAr: "مكافأة تجريبية", nameEn: "Sample reward",
        priceCoins: 300, featured: true, purchaseAvailable: false,
      }],
    });
    const serialized = JSON.stringify(projected);
    for (const secret of ["123456789", "private-tenant-A", "9876543", "SECRET-VOUCHER-123", "VIP_SECRET", "private-internal-timestamp", "01000000000"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("never publishes inactive rewards, invalid price or malformed labels", () => {
    const variants = [
      { ...row(), itemId: 2, isActive: false },
      { ...row(), itemId: 3, priceCoins: -1 },
      { ...row(), itemId: 4, priceCoins: 0.5 },
      { ...row(), itemId: 5, priceCoins: Number.NaN },
      { ...row(), itemId: 6, nameAr: "" },
      { ...row(), itemId: 7, categoryId: -1 },
      { ...row(), itemId: 8, nameEn: "x".repeat(121) },
    ];
    expect(projectPublicRewardCatalog(variants).items).toEqual([]);
    expect(projectPublicRewardCatalog(null).items).toEqual([]);
  });

  it("caps items, deduplicates and defaults to never-purchasable", () => {
    const rows = [
      row(), { ...row(), nameEn: "Duplicate" },
      ...Array.from({ length: 200 }, (_, i) => ({ ...row(), itemId: i + 2, isFeatured: false })),
    ];
    const projected = projectPublicRewardCatalog(rows);
    expect(projected.items).toHaveLength(100);
    expect(new Set(projected.items.map(x => x.itemId)).size).toBe(100);
    expect(projected.items.every(x => x.purchaseAvailable === false)).toBe(true);
    expect(Object.isFrozen(projected.items)).toBe(true);
  });

  it("contains no DB, anonymous member lookups or financial operation imports", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/cut-club/publicRewardCatalog.ts"), "utf8");
    const executable = src.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const forbidden of ["getPool", "fetch(", "searchParams", "getClientBalance", "purchaseStoreItem", "openMysteryBox", "redeemClientReward", "localStorage", "clientIdParam"]) {
      expect(executable).not.toContain(forbidden);
    }
    expect(executable).not.toMatch(/from\s+["']@\/lib\/(?:db|store\/store\.service)/);
  });
});

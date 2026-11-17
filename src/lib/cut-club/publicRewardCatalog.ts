/**
 * CUT CLUB public catalog projection (issue #276), safe browser DTO only.
 *
 * This NEVER authenticates a member or queries a tenant/database.
 * Input MUST come from a future, independently verified, TENANT-SCOPED
 * public catalog source; callers may not select customers by clientId.
 * Old combined private /api/public/client/store endpoints stay quarantined.
 */
export type PublicRewardItem = Readonly<{
  itemId: number;
  categoryId: number;
  nameAr: string;
  nameEn: string;
  priceCoins: number;
  featured: boolean;
  purchaseAvailable: false;
}>;

export type PublicRewardCatalog = Readonly<{
  mode: "browse_only";
  items: readonly PublicRewardItem[];
}>;

const maxItems = 100;
const validId = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n > 0;
const validCoins = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const validName = (name: unknown): name is string =>
  typeof name === "string" && name.trim().length > 0 && name.trim().length <= 120;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Accepts only explicitly publishable active rows.
 * Negative, fractional or imprecise prices are omitted rather than rounded.
 * No balances, stocks, ownership, vouchers, tiers, customer data or internal
 * service/product IDs are copied into the public result.
 *
 * No source validation can compensate for missing upstream tenant scope.
 */
export function projectPublicRewardCatalog(rows: unknown): PublicRewardCatalog {
  const items: PublicRewardItem[] = [];
  if (!Array.isArray(rows)) return { mode: "browse_only", items };
  const seen = new Set<number>();

  for (const raw of rows) {
    if (!record(raw) || raw.isActive !== true ||
        !validId(raw.itemId) || !validId(raw.categoryId) ||
        !validName(raw.nameAr) || !validName(raw.nameEn) ||
        !validCoins(raw.priceCoins) || seen.has(raw.itemId)) continue;

    seen.add(raw.itemId);
    items.push(Object.freeze({
      itemId: raw.itemId,
      categoryId: raw.categoryId,
      nameAr: raw.nameAr.trim(),
      nameEn: raw.nameEn.trim(),
      priceCoins: raw.priceCoins,
      featured: raw.isFeatured === true,
      purchaseAvailable: false as const,
    }));
    if (items.length >= maxItems) break;
  }

  return Object.freeze({ mode: "browse_only", items: Object.freeze(items) });
}

import 'server-only';
import { getPool, sql } from '@/lib/db';
import { getCutClubSession } from './memberOtp';
import { runRewardPurchase, type PurchaseOutcome, type RewardOwner } from './rewardSettlement';
import { createSqlRewardPurchasePort } from './sqlRewardPurchasePort';

export type RewardCatalogItem = {
  itemId: number; title: string; description: string | null; priceCoins: number;
  minTier: string | null; inStock: boolean; validityDays: number | null;
};
export type RewardCatalog = {
  purchaseEnabled: boolean;
  /** Present only for a linked (ACTIVE) member session. */
  balanceCoins: number | null;
  items: RewardCatalogItem[];
};

/** Purchase is OFF unless explicitly enabled AND a salon is configured. */
export function rewardPurchaseConfig(env: NodeJS.ProcessEnv = process.env): { salonId: number } | null {
  if (env.CUT_CLUB_REWARD_PURCHASE_ENABLED !== 'true') return null;
  const salonId = Number(env.CUT_CLUB_REWARD_SALON_ID);
  return Number.isSafeInteger(salonId) && salonId > 0 ? { salonId } : null;
}

/**
 * Real catalog from TblLoyaltyStoreItem. Only FREE_SERVICE rewards that are
 * mapped to a POS service are listed: anything else could not be honored by
 * the cashier, so it must not be sold for Coins.
 */
export async function loadRewardCatalog(sessionToken: unknown): Promise<RewardCatalog> {
  const config = rewardPurchaseConfig();
  const session = typeof sessionToken === 'string' && sessionToken ? await getCutClubSession(sessionToken) : null;
  const db = await getPool();
  const items = await db.request()
    .input('salonId', sql.Int, config?.salonId ?? null)
    .query<{ ItemID: number; NameAr: string; DescriptionAr: string | null; PriceCoins: number; TierNameAr: string | null;
      UnlimitedStock: boolean; StockQuantity: number | null; ExpiresAfterDays: number | null }>(`
      SELECT si.ItemID,si.NameAr,si.DescriptionAr,si.PriceCoins,t.TierNameAr,
             si.UnlimitedStock,si.StockQuantity,si.ExpiresAfterDays
      FROM dbo.TblLoyaltyStoreItem si
      LEFT JOIN dbo.TblLoyaltyTier t ON t.TierID=si.MinTierID AND t.IsActive=1
      WHERE si.IsActive=1 AND si.ItemType=N'FREE_SERVICE' AND si.ServiceID IS NOT NULL
        AND si.PriceCoins>0
        AND (@salonId IS NULL OR si.SalonID=@salonId OR si.SalonID IS NULL)
      ORDER BY si.PriceCoins,si.ItemID
    `);
  let balance: number | null = null;
  if (session?.linkStatus === 'ACTIVE' && session.legacyClientId) {
    const r = await db.request().input('tenant', sql.UniqueIdentifier, session.tenantId)
      .input('clientId', sql.Int, session.legacyClientId)
      .query<{ PointsBalance: number }>(`
        SELECT TOP (2) cl.PointsBalance FROM dbo.TblClientLoyalty cl
        JOIN dbo.TblClient c ON c.ClientID=cl.ClientID AND c.TenantId=@tenant
        WHERE cl.ClientID=@clientId AND cl.IsActive=1
      `);
    if (r.recordset.length === 1) balance = Number(r.recordset[0].PointsBalance);
  }
  return {
    purchaseEnabled: config !== null,
    balanceCoins: balance !== null && Number.isFinite(balance) ? balance : null,
    items: items.recordset.map(i => ({
      itemId: i.ItemID, title: String(i.NameAr).slice(0, 150),
      description: i.DescriptionAr ? String(i.DescriptionAr).slice(0, 500) : null,
      priceCoins: Number(i.PriceCoins), minTier: i.TierNameAr ?? null,
      inStock: i.UnlimitedStock === true || Number(i.StockQuantity) > 0,
      validityDays: i.ExpiresAfterDays ?? null,
    })),
  };
}

/** Customer identity comes ONLY from the verified session; salon only from config. */
export async function purchaseMemberReward(
  sessionToken: unknown, itemId: unknown, idempotencyKey: unknown,
): Promise<PurchaseOutcome | { ok: false; reason: 'disabled' | 'session_required' | 'not_linked' }> {
  const config = rewardPurchaseConfig();
  if (!config) return { ok: false, reason: 'disabled' };
  const session = await getCutClubSession(sessionToken);
  if (!session) return { ok: false, reason: 'session_required' };
  if (session.linkStatus !== 'ACTIVE' || !session.legacyClientId) return { ok: false, reason: 'not_linked' };
  if (typeof itemId !== 'number' || typeof idempotencyKey !== 'string') return { ok: false, reason: 'unavailable' };
  const pool = await getPool();
  const owner: RewardOwner = { tenantId: session.tenantId, customerId: session.legacyClientId, salonId: config.salonId };
  return runRewardPurchase({
    owner, itemId, idempotencyKey, nowSeconds: Math.floor(Date.now() / 1000),
    port: createSqlRewardPurchasePort(pool),
    async verifyOwnedCustomerAndSalon(o) {
      const r = await pool.request()
        .input('tenant', sql.UniqueIdentifier, o.tenantId)
        .input('clientId', sql.Int, o.customerId).input('salonId', sql.Int, o.salonId)
        .query<{ Ok: number }>(`
          SELECT CASE WHEN EXISTS (SELECT 1 FROM dbo.TblClient WHERE TenantId=@tenant AND ClientID=@clientId)
            AND EXISTS (SELECT 1 FROM dbo.Location WHERE LegacyBranchId=@salonId AND TenantId=@tenant AND Status=N'active')
            THEN 1 ELSE 0 END AS Ok
        `);
      return r.recordset[0]?.Ok === 1;
    },
  });
}

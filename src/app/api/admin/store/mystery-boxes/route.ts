// ============================================
// GET  /api/admin/store/mystery-boxes
// POST /api/admin/store/mystery-boxes
// ============================================

import { NextResponse } from "next/server";
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { getPool, sql } from "@/lib/db";

export const runtime = "nodejs";

// GET - List all mystery boxes with rewards
export async function GET() {
  const __auth = await requirePageAccess('/admin/cut-club');
  if (!isAuthResult(__auth)) return __auth;

  try {
    const db = await getPool();

    // Get mystery box items
    const itemsResult = await db.request().query(`
      SELECT
        si.ItemID,
        si.CategoryID,
        si.Code,
        si.NameAr,
        si.NameEn,
        si.DescriptionAr,
        si.DescriptionEn,
        si.PriceCoins,
        si.MinTierID,
        lt.TierCode as MinTierCode,
        si.StockQuantity,
        si.UnlimitedStock,
        si.ExpiresAfterDays,
        si.ImageUrl,
        si.BadgeText,
        si.IsFeatured,
        si.IsActive,
        si.SortOrder,
        (SELECT COUNT(*) FROM [dbo].[TblClientInventory] ci WHERE ci.ItemID = si.ItemID AND ci.Status = 'USED') as TotalOpened
      FROM [dbo].[TblLoyaltyStoreItem] si
      LEFT JOIN [dbo].[TblLoyaltyTier] lt ON lt.TierID = si.MinTierID
      WHERE si.ItemType = 'MYSTERY_BOX'
      ORDER BY si.SortOrder, si.ItemID
    `);

    // Get all rewards
    const rewardsResult = await db.request().query(`
      SELECT
        RewardID,
        BoxItemID,
        RewardType,
        RewardValue,
        ProbabilityWeight,
        NameAr,
        NameEn,
        IsActive
      FROM [dbo].[TblMysteryBoxReward]
      WHERE IsActive = 1
      ORDER BY RewardID
    `);

    const rewardsMap = new Map<number, any[]>();
    for (const r of rewardsResult.recordset) {
      const list = rewardsMap.get(r.BoxItemID) || [];
      list.push({
        rewardId: r.RewardID,
        boxItemId: r.BoxItemID,
        rewardType: r.RewardType,
        rewardValue: r.RewardValue,
        probabilityWeight: r.ProbabilityWeight,
        nameAr: r.NameAr,
        nameEn: r.NameEn,
        isActive: r.IsActive,
      });
      rewardsMap.set(r.BoxItemID, list);
    }

    const boxes = itemsResult.recordset.map((row: Record<string, unknown>) => ({
      itemId: row.ItemID,
      categoryId: row.CategoryID,
      code: row.Code,
      nameAr: row.NameAr,
      nameEn: row.NameEn,
      descriptionAr: row.DescriptionAr,
      descriptionEn: row.DescriptionEn,
      priceCoins: row.PriceCoins,
      minTierCode: row.MinTierCode,
      stockQuantity: row.StockQuantity,
      unlimitedStock: row.UnlimitedStock,
      expiresAfterDays: row.ExpiresAfterDays,
      imageUrl: row.ImageUrl,
      badgeText: row.BadgeText,
      isFeatured: row.IsFeatured,
      isActive: row.IsActive,
      sortOrder: row.SortOrder,
      totalOpened: row.TotalOpened,
      rewards: rewardsMap.get(row.ItemID as number) || [],
    }));

    return NextResponse.json({ ok: true, boxes });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin/store/mystery-boxes GET] error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// POST - Create a new mystery box
export async function POST(req: Request) {
  const __auth = await requirePageAccess('/admin/cut-club');
  if (!isAuthResult(__auth)) return __auth;

  try {
    const body = await req.json();
    const db = await getPool();
    const transaction = new sql.Transaction(db);
    await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

    try {
      // 1. Insert store item
      const itemReq = new sql.Request(transaction);
      const itemResult = await itemReq
        .input("categoryId", sql.Int, body.categoryId || 1)
        .input("code", sql.NVarChar(50), body.code)
        .input("nameAr", sql.NVarChar(200), body.nameAr)
        .input("nameEn", sql.NVarChar(200), body.nameEn)
        .input("descriptionAr", sql.NVarChar(500), body.descriptionAr || null)
        .input("descriptionEn", sql.NVarChar(500), body.descriptionEn || null)
        .input("itemType", sql.NVarChar(30), "MYSTERY_BOX")
        .input("priceCoins", sql.Decimal(10, 2), body.priceCoins)
        .input("value", sql.Decimal(10, 2), body.value || null)
        .input("minTierId", sql.Int, body.minTierId || null)
        .input("stockQuantity", sql.Int, body.stockQuantity || null)
        .input("unlimitedStock", sql.Bit, body.unlimitedStock ? 1 : 0)
        .input("expiresAfterDays", sql.Int, body.expiresAfterDays || null)
        .input("imageUrl", sql.NVarChar(500), body.imageUrl || null)
        .input("badgeText", sql.NVarChar(100), body.badgeText || null)
        .input("isFeatured", sql.Bit, body.isFeatured ? 1 : 0)
        .input("isActive", sql.Bit, body.isActive ? 1 : 0)
        .input("sortOrder", sql.Int, body.sortOrder || 0).query(`
          INSERT INTO [dbo].[TblLoyaltyStoreItem] (
            CategoryID, Code, NameAr, NameEn, DescriptionAr, DescriptionEn,
            ItemType, PriceCoins, Value, MinTierID,
            StockQuantity, UnlimitedStock, ExpiresAfterDays, ImageUrl, BadgeText,
            IsFeatured, IsActive, SortOrder, CreatedAt, UpdatedAt
          )
          OUTPUT INSERTED.ItemID
          VALUES (
            @categoryId, @code, @nameAr, @nameEn, @descriptionAr, @descriptionEn,
            @itemType, @priceCoins, @value, @minTierId,
            @stockQuantity, @unlimitedStock, @expiresAfterDays, @imageUrl, @badgeText,
            @isFeatured, @isActive, @sortOrder, GETDATE(), GETDATE()
          )
        `);

      const itemId = itemResult.recordset[0].ItemID;

      // 2. Insert rewards
      if (Array.isArray(body.rewards) && body.rewards.length > 0) {
        for (const reward of body.rewards) {
          const rewardReq = new sql.Request(transaction);
          await rewardReq
            .input("boxItemId", sql.Int, itemId)
            .input("rewardType", sql.NVarChar(30), reward.rewardType || "COINS")
            .input("rewardValue", sql.Decimal(10, 2), reward.rewardValue || 0)
            .input("probabilityWeight", sql.Decimal(5, 2), reward.probabilityWeight || 0)
            .input("nameAr", sql.NVarChar(200), reward.nameAr)
            .input("nameEn", sql.NVarChar(200), reward.nameEn || reward.nameAr)
            .input("descriptionAr", sql.NVarChar(500), reward.descriptionAr || null)
            .input("descriptionEn", sql.NVarChar(500), reward.descriptionEn || null)
            .input("isActive", sql.Bit, reward.isActive !== false ? 1 : 0).query(`
              INSERT INTO [dbo].[TblMysteryBoxReward] (
                BoxItemID, RewardType, RewardValue, ProbabilityWeight,
                NameAr, NameEn, DescriptionAr, DescriptionEn, IsActive, CreatedAt, UpdatedAt
              )
              VALUES (
                @boxItemId, @rewardType, @rewardValue, @probabilityWeight,
                @nameAr, @nameEn, @descriptionAr, @descriptionEn, @isActive, GETDATE(), GETDATE()
              )
            `);
        }
      }

      await transaction.commit();
      return NextResponse.json({ ok: true, itemId });
    } catch (innerErr) {
      await transaction.rollback();
      throw innerErr;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin/store/mystery-boxes POST] error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

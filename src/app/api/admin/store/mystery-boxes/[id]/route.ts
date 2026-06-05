// ============================================
// PATCH /api/admin/store/mystery-boxes/:id
// DELETE /api/admin/store/mystery-boxes/:id
// ============================================

import { NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const itemId = parseInt(id);
    const body = await req.json();
    const db = await getPool();
    const transaction = new sql.Transaction(db);
    await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

    try {
      // Update store item fields
      const updateFields: string[] = [];
      const request = new sql.Request(transaction);

      if (body.nameAr !== undefined) {
        updateFields.push("NameAr = @nameAr");
        request.input("nameAr", sql.NVarChar(200), body.nameAr);
      }
      if (body.nameEn !== undefined) {
        updateFields.push("NameEn = @nameEn");
        request.input("nameEn", sql.NVarChar(200), body.nameEn);
      }
      if (body.descriptionAr !== undefined) {
        updateFields.push("DescriptionAr = @descriptionAr");
        request.input("descriptionAr", sql.NVarChar(500), body.descriptionAr);
      }
      if (body.descriptionEn !== undefined) {
        updateFields.push("DescriptionEn = @descriptionEn");
        request.input("descriptionEn", sql.NVarChar(500), body.descriptionEn);
      }
      if (body.priceCoins !== undefined) {
        updateFields.push("PriceCoins = @priceCoins");
        request.input("priceCoins", sql.Decimal(10, 2), body.priceCoins);
      }
      if (body.value !== undefined) {
        updateFields.push("Value = @value");
        request.input("value", sql.Decimal(10, 2), body.value);
      }
      if (body.minTierId !== undefined) {
        updateFields.push("MinTierID = @minTierId");
        request.input("minTierId", sql.Int, body.minTierId);
      }
      if (body.stockQuantity !== undefined) {
        updateFields.push("StockQuantity = @stockQuantity");
        request.input("stockQuantity", sql.Int, body.stockQuantity);
      }
      if (body.unlimitedStock !== undefined) {
        updateFields.push("UnlimitedStock = @unlimitedStock");
        request.input("unlimitedStock", sql.Bit, body.unlimitedStock ? 1 : 0);
      }
      if (body.expiresAfterDays !== undefined) {
        updateFields.push("ExpiresAfterDays = @expiresAfterDays");
        request.input("expiresAfterDays", sql.Int, body.expiresAfterDays);
      }
      if (body.imageUrl !== undefined) {
        updateFields.push("ImageUrl = @imageUrl");
        request.input("imageUrl", sql.NVarChar(500), body.imageUrl);
      }
      if (body.badgeText !== undefined) {
        updateFields.push("BadgeText = @badgeText");
        request.input("badgeText", sql.NVarChar(100), body.badgeText);
      }
      if (body.isFeatured !== undefined) {
        updateFields.push("IsFeatured = @isFeatured");
        request.input("isFeatured", sql.Bit, body.isFeatured ? 1 : 0);
      }
      if (body.isActive !== undefined) {
        updateFields.push("IsActive = @isActive");
        request.input("isActive", sql.Bit, body.isActive ? 1 : 0);
      }
      if (body.sortOrder !== undefined) {
        updateFields.push("SortOrder = @sortOrder");
        request.input("sortOrder", sql.Int, body.sortOrder);
      }

      if (updateFields.length > 0) {
        updateFields.push("UpdatedAt = GETDATE()");
        request.input("itemId", sql.Int, itemId);
        await request.query(`
          UPDATE [dbo].[TblLoyaltyStoreItem]
          SET ${updateFields.join(", ")}
          WHERE ItemID = @itemId AND ItemType = 'MYSTERY_BOX'
        `);
      }

      // Handle rewards: replace all with new list if provided
      if (Array.isArray(body.rewards)) {
        // Delete existing rewards
        const delReq = new sql.Request(transaction);
        await delReq
          .input("boxItemId", sql.Int, itemId)
          .query("DELETE FROM [dbo].[TblMysteryBoxReward] WHERE BoxItemID = @boxItemId");

        // Insert new rewards
        for (const reward of body.rewards) {
          const rewardReq = new sql.Request(transaction);
          await rewardReq
            .input("boxItemId", sql.Int, itemId)
            .input("rewardType", sql.NVarChar(30), reward.rewardType || "COINS")
            .input("rewardValue", sql.Decimal(10, 2), reward.rewardValue || 0)
            .input("probabilityWeight", sql.Decimal(5, 2), reward.probabilityWeight || 0)
            .input("nameAr", sql.NVarChar(200), reward.nameAr)
            .input("nameEn", sql.NVarChar(200), reward.nameEn || reward.nameAr)
            .input("isActive", sql.Bit, reward.isActive !== false ? 1 : 0).query(`
              INSERT INTO [dbo].[TblMysteryBoxReward] (
                BoxItemID, RewardType, RewardValue, ProbabilityWeight,
                NameAr, NameEn, IsActive, CreatedAt, UpdatedAt
              )
              VALUES (
                @boxItemId, @rewardType, @rewardValue, @probabilityWeight,
                @nameAr, @nameEn, @isActive, GETDATE(), GETDATE()
              )
            `);
        }
      }

      await transaction.commit();
      return NextResponse.json({ ok: true });
    } catch (innerErr) {
      await transaction.rollback();
      throw innerErr;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin/store/mystery-boxes PATCH] error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const itemId = parseInt(id);
    const db = await getPool();

    // Soft delete: deactivate the store item
    await db.request().input("itemId", sql.Int, itemId).query(`
      UPDATE [dbo].[TblLoyaltyStoreItem]
      SET IsActive = 0, UpdatedAt = GETDATE()
      WHERE ItemID = @itemId AND ItemType = 'MYSTERY_BOX'
    `);

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin/store/mystery-boxes DELETE] error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// ============================================
// CUT CLUB STORE - Mystery Box Service Layer
// ============================================

import { getPool, sql } from "@/lib/db";
import type {
  MysteryBoxReward,
  MysteryBoxOpenResult,
  RawMysteryBoxRewardFromDb,
} from "./store.types";
import { selectWeightedRandom } from "./store.helpers";
import { getInventoryItemById } from "./inventory.service";
import { getClientBalance } from "./store.service";

// ============================================
// Get Mystery Box Rewards
// ============================================
export async function getMysteryBoxRewards(
  boxItemId: number,
): Promise<MysteryBoxReward[]> {
  const db = await getPool();

  const query = `
    SELECT 
      RewardID,
      BoxItemID,
      SalonID,
      RewardType,
      RewardValue,
      RewardItemID,
      ProbabilityWeight,
      NameAr,
      NameEn,
      DescriptionAr,
      DescriptionEn,
      IsActive,
      CreatedAt,
      UpdatedAt
    FROM [dbo].[TblMysteryBoxReward]
    WHERE BoxItemID = @boxItemId
      AND IsActive = 1
  `;

  const result = await db
    .request()
    .input("boxItemId", sql.Int, boxItemId)
    .query<RawMysteryBoxRewardFromDb>(query);

  return result.recordset.map((row) => ({
    rewardId: row.RewardID,
    boxItemId: row.BoxItemID,
    rewardType: row.RewardType as MysteryBoxReward["rewardType"],
    rewardValue: row.RewardValue,
    rewardItemId: row.RewardItemID,
    nameAr: row.NameAr,
    nameEn: row.NameEn,
    descriptionAr: row.DescriptionAr,
    descriptionEn: row.DescriptionEn,
    probabilityWeight: row.ProbabilityWeight,
    isActive: row.IsActive,
  }));
}

// ============================================
// Open Mystery Box
// ============================================
export async function openMysteryBox(
  inventoryId: number,
  clientId: number,
): Promise<MysteryBoxOpenResult> {
  // Get inventory item
  const inventoryItem = await getInventoryItemById(inventoryId);

  if (!inventoryItem) {
    throw new Error("Inventory item not found");
  }

  if (inventoryItem.clientId !== clientId) {
    throw new Error("Unauthorized access");
  }

  if (inventoryItem.status !== "ACTIVE") {
    throw new Error("Item is not active");
  }

  if (inventoryItem.item.itemType !== "MYSTERY_BOX") {
    throw new Error("Item is not a mystery box");
  }

  // Get available rewards for this box
  const rewards = await getMysteryBoxRewards(inventoryItem.item.itemId);

  if (rewards.length === 0) {
    throw new Error("No rewards configured for this mystery box");
  }

  // Select random reward based on probability weights
  const selectedReward = selectWeightedRandom(rewards);

  if (!selectedReward) {
    throw new Error("Failed to select reward");
  }

  const db = await getPool();

  // Read balance BEFORE opening (outside transaction, used for ledger PointsBefore)
  const balanceBefore = await getClientBalance(clientId);

  const transaction = new sql.Transaction(db);
  await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

  try {
    // ── 1. Mark mystery box as used (inlined to avoid nested transaction) ──
    const now = new Date();
    const openNotes = `Opened mystery box - Reward: ${selectedReward.nameAr}`;

    const updateInvReq = new sql.Request(transaction);
    await updateInvReq
      .input("inventoryId", sql.Int, inventoryId)
      .input("usedAt", sql.DateTime, now)
      .input("notes", sql.NVarChar(500), openNotes)
      .query(`
        UPDATE [dbo].[TblClientInventory]
        SET Status = 'USED', UsedAt = @usedAt, Notes = @notes
        WHERE InventoryID = @inventoryId AND Status = 'ACTIVE'
      `);

    const logOpenReq = new sql.Request(transaction);
    await logOpenReq
      .input("inventoryId", sql.Int, inventoryId)
      .input("clientId", sql.Int, clientId)
      .input("actionType", sql.NVarChar(50), "USED")
      .input("usedAt", sql.DateTime, now)
      .input("notes", sql.NVarChar(500), openNotes)
      .query(`
        INSERT INTO [dbo].[TblInventoryUsageLog] (InventoryID, ClientID, ActionType, UsedAt, Notes)
        VALUES (@inventoryId, @clientId, @actionType, @usedAt, @notes)
      `);

    // ── 2. Apply reward ──
    let balanceAfter = balanceBefore;

    switch (selectedReward.rewardType) {
      case "COINS":
      case "BONUS_POINTS": {
        const isBonus = selectedReward.rewardType === "BONUS_POINTS";
        balanceAfter = balanceBefore + selectedReward.rewardValue;

        const updateBalReq = new sql.Request(transaction);
        const updateQ = isBonus
          ? `UPDATE [dbo].[TblClientLoyalty]
               SET PointsBalance = PointsBalance + @amount,
                   LifetimeEarnedPoints = LifetimeEarnedPoints + @amount,
                   UpdatedAt = GETDATE()
               WHERE ClientID = @clientId`
          : `UPDATE [dbo].[TblClientLoyalty]
               SET PointsBalance = PointsBalance + @amount,
                   UpdatedAt = GETDATE()
               WHERE ClientID = @clientId`;
        await updateBalReq
          .input("clientId", sql.Int, clientId)
          .input("amount", sql.Decimal(18, 2), selectedReward.rewardValue)
          .query(updateQ);

        const movementType = isBonus ? "BONUS_POINTS_REWARD" : "MYSTERY_BOX_OPEN";
        const idempotencyKey = `MYSTERY-${selectedReward.rewardType}-${clientId}-${Date.now()}`;
        const ledgerReq = new sql.Request(transaction);
        await ledgerReq
          .input("clientId", sql.Int, clientId)
          .input("movementType", sql.NVarChar(20), movementType)
          .input("pointsDelta", sql.Decimal(10, 2), selectedReward.rewardValue)
          .input("pointsBefore", sql.Decimal(10, 2), balanceBefore)
          .input("pointsAfter", sql.Decimal(10, 2), balanceAfter)
          .input("notes", sql.NVarChar(500), `Mystery box reward: ${selectedReward.nameAr}`)
          .input("idempotencyKey", sql.NVarChar(100), idempotencyKey)
          .query(`
            INSERT INTO [dbo].[TblLoyaltyPointLedger] (
              ClientID, ClientLoyaltyID, MovementType, PointsDelta, PointsBefore, PointsAfter, Notes, IdempotencyKey, CreatedAt
            )
            SELECT
              @clientId, ClientLoyaltyID, @movementType,
              @pointsDelta, @pointsBefore, @pointsAfter,
              @notes, @idempotencyKey, GETDATE()
            FROM [dbo].[TblClientLoyalty]
            WHERE ClientID = @clientId
          `);
        break;
      }

      case "STORE_ITEM": {
        if (selectedReward.rewardItemId) {
          const { generateVoucherCode, calculateExpiryDate } = await import("./store.helpers");
          const { getStoreItemById } = await import("./store.service");

          const rewardItem = await getStoreItemById(selectedReward.rewardItemId);
          if (rewardItem) {
            const voucherCode = generateVoucherCode(clientId, selectedReward.rewardItemId);
            const expiresAt = calculateExpiryDate(new Date(), rewardItem.expiresAfterDays);

            const inventoryReq = new sql.Request(transaction);
            await inventoryReq
              .input("clientId", sql.Int, clientId)
              .input("itemId", sql.Int, selectedReward.rewardItemId)
              .input("voucherCode", sql.NVarChar(100), voucherCode)
              .input("expiresAt", sql.DateTime, expiresAt)
              .query(`
                INSERT INTO [dbo].[TblClientInventory] (
                  ClientID, ItemID, Quantity, Status, PurchasePriceCoins,
                  VoucherCode, PurchasedAt, ExpiresAt, Notes
                )
                VALUES (@clientId, @itemId, 1, 'ACTIVE', 0, @voucherCode, GETDATE(), @expiresAt, 'Mystery box reward')
              `);
          }
        }
        break;
      }

      default:
        // DISCOUNT, JACKPOT — reward is recorded; POS applies the effect on next visit
        break;
    }

    await transaction.commit();

    return {
      ok: true,
      success: true,
      reward: {
        type: selectedReward.rewardType,
        nameAr: selectedReward.nameAr,
        nameEn: selectedReward.nameEn,
        value: selectedReward.rewardValue,
        itemId: selectedReward.rewardItemId,
      },
      newBalance: balanceAfter,
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

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
import { getInventoryItemById, useInventoryItem } from "./inventory.service";
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
  const transaction = new sql.Transaction(db);
  await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

  try {
    // Mark mystery box as used
    await useInventoryItem(
      inventoryId,
      null,
      null,
      `Opened mystery box - Reward: ${selectedReward.nameAr}`,
    );

    // Apply reward based on type
    let newBalance = await getClientBalance(clientId);

    switch (selectedReward.rewardType) {
      case "COINS": {
        // Add coins to balance
        const addCoinsReq = new sql.Request(transaction);
        await addCoinsReq
          .input("clientId", sql.Int, clientId)
          .input("amount", sql.Decimal(18, 2), selectedReward.rewardValue)
          .query(`
            UPDATE [dbo].[TblClientLoyalty]
            SET PointsBalance = PointsBalance + @amount,
                UpdatedAt = GETDATE()
            WHERE ClientID = @clientId
          `);

        // Add ledger entry
        const idempotencyKeyCoins = `MYSTERY-${clientId}-${Date.now()}`;
        const ledgerReq = new sql.Request(transaction);
        await ledgerReq
          .input("clientId", sql.Int, clientId)
          .input("movementType", sql.NVarChar(20), "MYSTERY_BOX_OPEN")
          .input("pointsDelta", sql.Decimal(10, 2), selectedReward.rewardValue)
          .input("notes", sql.NVarChar(500), `Mystery box reward: ${selectedReward.nameAr}`)
          .input("idempotencyKey", sql.NVarChar(100), idempotencyKeyCoins)
          .query(`
            INSERT INTO [dbo].[TblLoyaltyPointLedger] (
              ClientID, ClientLoyaltyID, MovementType, PointsDelta, PointsBefore, PointsAfter, Notes, IdempotencyKey, CreatedAt
            )
            SELECT 
              @clientId,
              ClientLoyaltyID,
              @movementType,
              @pointsDelta,
              PointsBalance - @pointsDelta,
              PointsBalance,
              @notes,
              @idempotencyKey,
              GETDATE()
            FROM [dbo].[TblClientLoyalty]
            WHERE ClientID = @clientId
          `);

        newBalance += selectedReward.rewardValue;
        break;
      }

      case "STORE_ITEM": {
        // Add item to inventory
        if (selectedReward.rewardItemId) {
          const { generateVoucherCode, calculateExpiryDate } = await import(
            "./store.helpers"
          );
          const { getStoreItemById } = await import("./store.service");

          const rewardItem = await getStoreItemById(selectedReward.rewardItemId);
          if (rewardItem) {
            const voucherCode = generateVoucherCode(
              clientId,
              selectedReward.rewardItemId,
            );
            const expiresAt = calculateExpiryDate(
              new Date(),
              rewardItem.expiresAfterDays,
            );

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
                VALUES (
                  @clientId, @itemId, 1, 'ACTIVE', 0,
                  @voucherCode, GETDATE(), @expiresAt, 'Mystery box reward'
                )
              `);
          }
        }
        break;
      }

      case "BONUS_POINTS": {
        // Add bonus points
        const addPointsReq = new sql.Request(transaction);
        await addPointsReq
          .input("clientId", sql.Int, clientId)
          .input("amount", sql.Decimal(18, 2), selectedReward.rewardValue)
          .query(`
            UPDATE [dbo].[TblClientLoyalty]
            SET PointsBalance = PointsBalance + @amount,
                LifetimeEarnedPoints = LifetimeEarnedPoints + @amount,
                UpdatedAt = GETDATE()
            WHERE ClientID = @clientId
          `);

        // Add ledger entry
        const idempotencyKeyBonus = `BONUS-${clientId}-${Date.now()}`;
        const ledgerReq = new sql.Request(transaction);
        await ledgerReq
          .input("clientId", sql.Int, clientId)
          .input("movementType", sql.NVarChar(20), "BONUS_POINTS_REWARD")
          .input("pointsDelta", sql.Decimal(10, 2), selectedReward.rewardValue)
          .input("notes", sql.NVarChar(500), `Mystery box bonus: ${selectedReward.nameAr}`)
          .input("idempotencyKey", sql.NVarChar(100), idempotencyKeyBonus)
          .query(`
            INSERT INTO [dbo].[TblLoyaltyPointLedger] (
              ClientID, ClientLoyaltyID, MovementType, PointsDelta, PointsBefore, PointsAfter, Notes, IdempotencyKey, CreatedAt
            )
            SELECT 
              @clientId,
              ClientLoyaltyID,
              @movementType,
              @pointsDelta,
              PointsBalance - @pointsDelta,
              PointsBalance,
              @notes,
              @idempotencyKey,
              GETDATE()
            FROM [dbo].[TblClientLoyalty]
            WHERE ClientID = @clientId
          `);

        newBalance += selectedReward.rewardValue;
        break;
      }

      default:
        // For DISCOUNT, JACKPOT, or other types, just record the reward
        break;
    }

    await transaction.commit();

    return {
      success: true,
      reward: {
        type: selectedReward.rewardType,
        nameAr: selectedReward.nameAr,
        nameEn: selectedReward.nameEn,
        value: selectedReward.rewardValue,
        itemId: selectedReward.rewardItemId,
      },
      newBalance,
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

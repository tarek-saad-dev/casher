// ============================================
// CUT CLUB STORE - Inventory Service Layer
// ============================================

import { getPool, sql } from "@/lib/db";
import type {
  InventoryItem,
  InventoryItemWithDetails,
  RawInventoryFromDb,
  InventoryUsageLog,
  StoreItem,
} from "./store.types";
import {
  mapDbInventoryToApi,
  addDetailsToInventoryItem,
} from "./store.helpers";
import { getStoreItemById } from "./store.service";
import { isValidClientId, isValidInventoryId } from "./store.validators";

// ============================================
// Get Client Inventory
// ============================================
export async function getClientInventory(
  clientId: number,
  status: string = "ACTIVE",
): Promise<InventoryItemWithDetails[]> {
  if (!isValidClientId(clientId)) {
    throw new Error("Invalid client ID");
  }

  const db = await getPool();

  let whereClause = "ci.ClientID = @clientId";
  if (status !== "ALL") {
    whereClause += " AND ci.Status = @status";
  }

  const query = `
    SELECT 
      ci.InventoryID,
      ci.ClientID,
      ci.ItemID,
      ci.Quantity,
      ci.Status,
      ci.PurchasePriceCoins,
      ci.VoucherCode,
      ci.PurchasedAt,
      ci.ExpiresAt,
      ci.UsedAt,
      ci.UsedInvID,
      ci.UsedBookingID,
      ci.Notes,
      si.ItemID,
      si.CategoryID,
      si.SalonID,
      si.Code,
      si.NameAr,
      si.NameEn,
      si.DescriptionAr,
      si.DescriptionEn,
      si.ItemType,
      si.PriceCoins,
      si.Value,
      si.ServiceID,
      si.ProductID,
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
      si.CreatedAt as ItemCreatedAt,
      si.UpdatedAt as ItemUpdatedAt
    FROM [dbo].[TblClientInventory] ci
    INNER JOIN [dbo].[TblLoyaltyStoreItem] si ON si.ItemID = ci.ItemID
    LEFT JOIN [dbo].[TblLoyaltyTier] lt ON lt.TierID = si.MinTierID
    WHERE ${whereClause}
    ORDER BY ci.PurchasedAt DESC
  `;

  const request = db.request().input("clientId", sql.Int, clientId);

  if (status !== "ALL") {
    request.input("status", sql.NVarChar(30), status);
  }

  const result = await request.query(query);

  const inventoryItems: InventoryItemWithDetails[] = [];

  for (const row of result.recordset) {
    const inventoryData: RawInventoryFromDb = {
      InventoryID: row.InventoryID,
      ClientID: row.ClientID,
      ItemID: row.ItemID,
      Quantity: row.Quantity,
      Status: row.Status,
      PurchasePriceCoins: row.PurchasePriceCoins,
      VoucherCode: row.VoucherCode,
      PurchasedAt: row.PurchasedAt,
      ExpiresAt: row.ExpiresAt,
      UsedAt: row.UsedAt,
      UsedInvID: row.UsedInvID,
      UsedBookingID: row.UsedBookingID,
      Notes: row.Notes,
    };

    const itemData: StoreItem = {
      itemId: row.ItemID,
      categoryId: row.CategoryID,
      code: row.Code,
      nameAr: row.NameAr,
      nameEn: row.NameEn,
      descriptionAr: row.DescriptionAr,
      descriptionEn: row.DescriptionEn,
      itemType: row.ItemType,
      priceCoins: row.PriceCoins,
      value: row.Value,
      serviceId: row.ServiceID,
      productId: row.ProductID,
      minTierCode: row.MinTierCode,
      stockQuantity: row.StockQuantity,
      unlimitedStock: row.UnlimitedStock,
      expiresAfterDays: row.ExpiresAfterDays,
      imageUrl: row.ImageUrl,
      badgeText: row.BadgeText,
      isFeatured: row.IsFeatured,
      isActive: row.IsActive,
      sortOrder: row.SortOrder,
    };

    const inventory = mapDbInventoryToApi(inventoryData, itemData);
    inventoryItems.push(addDetailsToInventoryItem(inventory));
  }

  return inventoryItems;
}

// ============================================
// Get Inventory Item by ID
// ============================================
export async function getInventoryItemById(
  inventoryId: number,
): Promise<InventoryItemWithDetails | null> {
  if (!isValidInventoryId(inventoryId)) {
    throw new Error("Invalid inventory ID");
  }

  const db = await getPool();

  const query = `
    SELECT 
      ci.InventoryID,
      ci.ClientID,
      ci.ItemID,
      ci.Quantity,
      ci.Status,
      ci.PurchasePriceCoins,
      ci.VoucherCode,
      ci.PurchasedAt,
      ci.ExpiresAt,
      ci.UsedAt,
      ci.UsedInvID,
      ci.UsedBookingID,
      ci.Notes
    FROM [dbo].[TblClientInventory] ci
    WHERE ci.InventoryID = @inventoryId
  `;

  const result = await db
    .request()
    .input("inventoryId", sql.Int, inventoryId)
    .query<RawInventoryFromDb>(query);

  if (result.recordset.length === 0) {
    return null;
  }

  const inventoryData = result.recordset[0];

  // Get item details
  const item = await getStoreItemById(inventoryData.ItemID);
  if (!item) {
    return null;
  }

  const inventory = mapDbInventoryToApi(inventoryData, item);
  return addDetailsToInventoryItem(inventory);
}

// ============================================
// Get Inventory Usage History
// ============================================
export async function getInventoryUsageHistory(
  inventoryId: number,
): Promise<InventoryUsageLog[]> {
  if (!isValidInventoryId(inventoryId)) {
    throw new Error("Invalid inventory ID");
  }

  const db = await getPool();

  const query = `
    SELECT 
      UsageID,
      ActionType,
      UsedAt,
      Notes,
      InvID,
      BookingID
    FROM [dbo].[TblInventoryUsageLog]
    WHERE InventoryID = @inventoryId
    ORDER BY UsedAt DESC
  `;

  const result = await db
    .request()
    .input("inventoryId", sql.Int, inventoryId)
    .query(query);

  return result.recordset.map((row) => ({
    usageId: row.UsageID,
    actionType: row.ActionType,
    usedAt: new Date(row.UsedAt).toISOString(),
    notes: row.Notes,
    invId: row.InvID,
    bookingId: row.BookingID,
  }));
}

// ============================================
// Get Inventory Stats
// ============================================
export async function getInventoryStats(clientId: number): Promise<{
  totalActive: number;
  totalUsed: number;
  expiringThisWeek: number;
}> {
  if (!isValidClientId(clientId)) {
    throw new Error("Invalid client ID");
  }

  const db = await getPool();

  const query = `
    SELECT 
      SUM(CASE WHEN Status = 'ACTIVE' THEN 1 ELSE 0 END) as TotalActive,
      SUM(CASE WHEN Status = 'USED' THEN 1 ELSE 0 END) as TotalUsed,
      SUM(CASE 
        WHEN Status = 'ACTIVE' 
          AND ExpiresAt IS NOT NULL 
          AND ExpiresAt <= DATEADD(day, 7, GETDATE())
          AND ExpiresAt > GETDATE()
        THEN 1 
        ELSE 0 
      END) as ExpiringThisWeek
    FROM [dbo].[TblClientInventory]
    WHERE ClientID = @clientId
  `;

  const result = await db
    .request()
    .input("clientId", sql.Int, clientId)
    .query(query);

  const stats = result.recordset[0];

  return {
    totalActive: stats.TotalActive || 0,
    totalUsed: stats.TotalUsed || 0,
    expiringThisWeek: stats.ExpiringThisWeek || 0,
  };
}

// ============================================
// Use Inventory Item (Mark as Used)
// ============================================
export async function useInventoryItem(
  inventoryId: number,
  invId: number | null = null,
  bookingId: number | null = null,
  notes: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  if (!isValidInventoryId(inventoryId)) {
    return { success: false, error: "Invalid inventory ID" };
  }

  const db = await getPool();

  // Check if item is active
  const checkQuery = `
    SELECT Status, ExpiresAt
    FROM [dbo].[TblClientInventory]
    WHERE InventoryID = @inventoryId
  `;

  const checkResult = await db
    .request()
    .input("inventoryId", sql.Int, inventoryId)
    .query(checkQuery);

  if (checkResult.recordset.length === 0) {
    return { success: false, error: "Inventory item not found" };
  }

  const item = checkResult.recordset[0];

  if (item.Status !== "ACTIVE") {
    return { success: false, error: "Item is not active" };
  }

  if (item.ExpiresAt && new Date(item.ExpiresAt) < new Date()) {
    return { success: false, error: "Item has expired" };
  }

  // Start transaction
  const transaction = new sql.Transaction(db);
  await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

  try {
    // Update inventory status
    const updateReq = new sql.Request(transaction);
    await updateReq
      .input("inventoryId", sql.Int, inventoryId)
      .input("usedAt", sql.DateTime, new Date())
      .input("usedInvId", sql.Int, invId)
      .input("usedBookingId", sql.Int, bookingId)
      .input("notes", sql.NVarChar(500), notes).query(`
        UPDATE [dbo].[TblClientInventory]
        SET Status = 'USED',
            UsedAt = @usedAt,
            UsedInvID = @usedInvId,
            UsedBookingID = @usedBookingId,
            Notes = @notes
        WHERE InventoryID = @inventoryId
      `);

    // Log usage
    const logReq = new sql.Request(transaction);
    await logReq
      .input("inventoryId", sql.Int, inventoryId)
      .input("actionType", sql.NVarChar(50), "USED")
      .input("usedAt", sql.DateTime, new Date())
      .input("invId", sql.Int, invId)
      .input("bookingId", sql.Int, bookingId)
      .input("notes", sql.NVarChar(500), notes).query(`
        INSERT INTO [dbo].[TblInventoryUsageLog] (
          InventoryID, ClientID, InvID, BookingID, ActionType, UsedAt, Notes
        )
        SELECT 
          @inventoryId,
          ClientID,
          @invId,
          @bookingId,
          @actionType,
          @usedAt,
          @notes
        FROM [dbo].[TblClientInventory]
        WHERE InventoryID = @inventoryId
      `);

    await transaction.commit();
    return { success: true };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

// ============================================
// Mark Expired Items
// ============================================
export async function markExpiredItems(): Promise<number> {
  const db = await getPool();

  const query = `
    UPDATE [dbo].[TblClientInventory]
    SET Status = 'EXPIRED'
    WHERE Status = 'ACTIVE'
      AND ExpiresAt IS NOT NULL
      AND ExpiresAt < GETDATE()
  `;

  const result = await db.request().query(query);
  return result.rowsAffected[0];
}

// ============================================
// Cancel Inventory Item
// ============================================
export async function cancelInventoryItem(
  inventoryId: number,
  refundCoins: boolean = false,
  notes: string | null = null,
): Promise<{ success: boolean; error?: string; refundedCoins?: number }> {
  if (!isValidInventoryId(inventoryId)) {
    return { success: false, error: "Invalid inventory ID" };
  }

  const db = await getPool();

  // Get inventory details
  const inventoryItem = await getInventoryItemById(inventoryId);
  if (!inventoryItem) {
    return { success: false, error: "Inventory item not found" };
  }

  if (inventoryItem.status !== "ACTIVE") {
    return { success: false, error: "Only active items can be cancelled" };
  }

  const transaction = new sql.Transaction(db);
  await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

  try {
    // Update inventory status
    const updateReq = new sql.Request(transaction);
    await updateReq
      .input("inventoryId", sql.Int, inventoryId)
      .input("notes", sql.NVarChar(500), notes).query(`
        UPDATE [dbo].[TblClientInventory]
        SET Status = 'CANCELLED',
            Notes = @notes
        WHERE InventoryID = @inventoryId
      `);

    let refundedCoins = 0;

    // Refund coins if requested
    if (refundCoins) {
      refundedCoins = inventoryItem.purchasePriceCoins;

      const refundReq = new sql.Request(transaction);
      await refundReq
        .input("clientId", sql.Int, inventoryItem.clientId)
        .input("amount", sql.Decimal(18, 2), refundedCoins).query(`
          UPDATE [dbo].[TblClientLoyalty]
          SET PointsBalance = PointsBalance + @amount,
              UpdatedAt = GETDATE()
          WHERE ClientID = @clientId
        `);

      // Add ledger entry
      const ledgerReq = new sql.Request(transaction);
      await ledgerReq
        .input("clientId", sql.Int, inventoryItem.clientId)
        .input("movementType", sql.NVarChar(20), "STORE_REFUND")
        .input("pointsDelta", sql.Decimal(10, 2), refundedCoins)
        .input("notes", sql.NVarChar(500), `Store refund: ${inventoryItem.item.nameAr}`).query(`
          INSERT INTO [dbo].[TblLoyaltyPointLedger] (
            ClientID, ClientLoyaltyID, MovementType, PointsDelta, PointsBefore, PointsAfter, Notes, CreatedAt
          )
          SELECT 
            @clientId,
            ClientLoyaltyID,
            @movementType,
            @pointsDelta,
            PointsBalance - @pointsDelta,
            PointsBalance,
            @notes,
            GETDATE()
          FROM [dbo].[TblClientLoyalty]
          WHERE ClientID = @clientId
        `);
    }

    // Log cancellation
    const logReq = new sql.Request(transaction);
    await logReq
      .input("inventoryId", sql.Int, inventoryId)
      .input("clientId", sql.Int, inventoryItem.clientId)
      .input("actionType", sql.NVarChar(50), refundCoins ? "REFUNDED" : "CANCELLED")
      .input("notes", sql.NVarChar(500), notes).query(`
        INSERT INTO [dbo].[TblInventoryUsageLog] (
          InventoryID, ClientID, ActionType, UsedAt, Notes
        )
        VALUES (
          @inventoryId, @clientId, @actionType, GETDATE(), @notes
        )
      `);

    await transaction.commit();

    return {
      success: true,
      refundedCoins: refundCoins ? refundedCoins : undefined,
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

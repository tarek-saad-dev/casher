// ============================================
// CUT CLUB STORE - Store Service Layer
// ============================================

import { getPool, sql } from "@/lib/db";
import type {
  StoreCategory,
  StoreItem,
  StoreItemWithStatus,
  RawStoreCategoryFromDb,
  RawStoreItemFromDb,
} from "./store.types";
import {
  mapDbCategoryToApi,
  mapDbStoreItemToApi,
  addStatusToStoreItem,
  validatePurchase,
  generateVoucherCode,
  calculateExpiryDate,
} from "./store.helpers";
import { isValidItemId, isValidClientId } from "./store.validators";

// ============================================
// Get All Store Categories
// ============================================
export async function getStoreCategories(
  salonId: number | null = null,
): Promise<StoreCategory[]> {
  const db = await getPool();

  const query = `
    SELECT 
      CategoryID,
      SalonID,
      Code,
      NameAr,
      NameEn,
      DescriptionAr,
      DescriptionEn,
      Icon,
      SortOrder,
      IsActive,
      CreatedAt,
      UpdatedAt
    FROM [dbo].[TblLoyaltyStoreCategory]
    WHERE IsActive = 1
      AND (SalonID IS NULL OR SalonID = @salonId)
    ORDER BY SortOrder, CategoryID
  `;

  const result = await db
    .request()
    .input("salonId", sql.Int, salonId)
    .query<RawStoreCategoryFromDb>(query);

  return result.recordset.map(mapDbCategoryToApi);
}

// ============================================
// Get Store Items by Category
// ============================================
export async function getStoreItemsByCategory(
  categoryId: number,
  salonId: number | null = null,
): Promise<StoreItem[]> {
  const db = await getPool();

  const query = `
    SELECT 
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
      si.CreatedAt,
      si.UpdatedAt
    FROM [dbo].[TblLoyaltyStoreItem] si
    LEFT JOIN [dbo].[TblLoyaltyTier] lt ON lt.TierID = si.MinTierID
    WHERE si.CategoryID = @categoryId
      AND si.IsActive = 1
      AND (si.SalonID IS NULL OR si.SalonID = @salonId)
    ORDER BY si.SortOrder, si.ItemID
  `;

  const result = await db
    .request()
    .input("categoryId", sql.Int, categoryId)
    .input("salonId", sql.Int, salonId)
    .query<RawStoreItemFromDb>(query);

  return result.recordset.map(mapDbStoreItemToApi);
}

// ============================================
// Get All Store Items
// ============================================
export async function getAllStoreItems(
  salonId: number | null = null,
): Promise<StoreItem[]> {
  const db = await getPool();

  const query = `
    SELECT 
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
      si.CreatedAt,
      si.UpdatedAt
    FROM [dbo].[TblLoyaltyStoreItem] si
    LEFT JOIN [dbo].[TblLoyaltyTier] lt ON lt.TierID = si.MinTierID
    WHERE si.IsActive = 1
      AND (si.SalonID IS NULL OR si.SalonID = @salonId)
    ORDER BY si.SortOrder, si.ItemID
  `;

  const result = await db
    .request()
    .input("salonId", sql.Int, salonId)
    .query<RawStoreItemFromDb>(query);

  return result.recordset.map(mapDbStoreItemToApi);
}

// ============================================
// Get Featured Store Items
// ============================================
export async function getFeaturedStoreItems(
  salonId: number | null = null,
): Promise<StoreItem[]> {
  const db = await getPool();

  const query = `
    SELECT TOP 6
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
      si.CreatedAt,
      si.UpdatedAt
    FROM [dbo].[TblLoyaltyStoreItem] si
    LEFT JOIN [dbo].[TblLoyaltyTier] lt ON lt.TierID = si.MinTierID
    WHERE si.IsFeatured = 1
      AND si.IsActive = 1
      AND (si.SalonID IS NULL OR si.SalonID = @salonId)
    ORDER BY si.SortOrder, si.ItemID
  `;

  const result = await db
    .request()
    .input("salonId", sql.Int, salonId)
    .query<RawStoreItemFromDb>(query);

  return result.recordset.map(mapDbStoreItemToApi);
}

// ============================================
// Get Store Item by ID
// ============================================
export async function getStoreItemById(
  itemId: number,
): Promise<StoreItem | null> {
  if (!isValidItemId(itemId)) {
    throw new Error("Invalid item ID");
  }

  const db = await getPool();

  const query = `
    SELECT 
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
      si.CreatedAt,
      si.UpdatedAt
    FROM [dbo].[TblLoyaltyStoreItem] si
    LEFT JOIN [dbo].[TblLoyaltyTier] lt ON lt.TierID = si.MinTierID
    WHERE si.ItemID = @itemId
  `;

  const result = await db
    .request()
    .input("itemId", sql.Int, itemId)
    .query<RawStoreItemFromDb>(query);

  if (result.recordset.length === 0) {
    return null;
  }

  return mapDbStoreItemToApi(result.recordset[0]);
}

// ============================================
// Get Client Balance (from TblClientLoyalty)
// ============================================
export async function getClientBalance(clientId: number): Promise<number> {
  if (!isValidClientId(clientId)) {
    throw new Error("Invalid client ID");
  }

  const db = await getPool();

  const query = `
    SELECT PointsBalance
    FROM [dbo].[TblClientLoyalty]
    WHERE ClientID = @clientId
  `;

  const result = await db
    .request()
    .input("clientId", sql.Int, clientId)
    .query(query);

  if (result.recordset.length === 0) {
    return 0;
  }

  return result.recordset[0].PointsBalance || 0;
}

// ============================================
// Get Client Tier Code
// ============================================
export async function getClientTierCode(clientId: number): Promise<string> {
  if (!isValidClientId(clientId)) {
    throw new Error("Invalid client ID");
  }

  const db = await getPool();

  const query = `
    SELECT lt.TierCode
    FROM [dbo].[TblClientLoyalty] cl
    LEFT JOIN [dbo].[TblLoyaltyTier] lt ON lt.TierID = cl.TierID
    WHERE cl.ClientID = @clientId
  `;

  const result = await db
    .request()
    .input("clientId", sql.Int, clientId)
    .query(query);

  if (result.recordset.length === 0) {
    return "BRONZE";
  }

  return result.recordset[0].TierCode || "BRONZE";
}

// ============================================
// Add Status to Store Items (for client)
// ============================================
export async function addStatusToStoreItems(
  items: StoreItem[],
  clientId: number,
): Promise<StoreItemWithStatus[]> {
  const balance = await getClientBalance(clientId);
  const tierCode = await getClientTierCode(clientId);

  return items.map((item) => addStatusToStoreItem(item, balance, tierCode));
}

// ============================================
// Purchase Store Item
// ============================================
export async function purchaseStoreItem(
  clientId: number,
  itemId: number,
): Promise<{
  success: boolean;
  inventoryId?: number;
  voucherCode?: string;
  expiresAt?: Date | null;
  error?: string;
}> {
  if (!isValidClientId(clientId)) {
    return { success: false, error: "Invalid client ID" };
  }

  if (!isValidItemId(itemId)) {
    return { success: false, error: "Invalid item ID" };
  }

  const db = await getPool();

  // Get item details
  const item = await getStoreItemById(itemId);
  if (!item) {
    return { success: false, error: "Item not found" };
  }

  // Get client balance and tier
  const balance = await getClientBalance(clientId);
  const tierCode = await getClientTierCode(clientId);

  // Validate purchase
  const validation = validatePurchase(item, balance, tierCode);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  // Start transaction
  const transaction = new sql.Transaction(db);
  await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

  try {
    // Generate voucher code
    const voucherCode = generateVoucherCode(clientId, itemId);

    // Calculate expiry date
    const purchaseDate = new Date();
    const expiresAt = calculateExpiryDate(purchaseDate, item.expiresAfterDays);

    // Insert into inventory
    const inventoryReq = new sql.Request(transaction);
    const inventoryResult = await inventoryReq
      .input("clientId", sql.Int, clientId)
      .input("itemId", sql.Int, itemId)
      .input("quantity", sql.Int, 1)
      .input("status", sql.NVarChar(30), "ACTIVE")
      .input("purchasePriceCoins", sql.Decimal(18, 2), item.priceCoins)
      .input("voucherCode", sql.NVarChar(100), voucherCode)
      .input("purchasedAt", sql.DateTime, purchaseDate)
      .input("expiresAt", sql.DateTime, expiresAt).query(`
        INSERT INTO [dbo].[TblClientInventory] (
          ClientID, ItemID, Quantity, Status, PurchasePriceCoins,
          VoucherCode, PurchasedAt, ExpiresAt
        )
        OUTPUT INSERTED.InventoryID
        VALUES (
          @clientId, @itemId, @quantity, @status, @purchasePriceCoins,
          @voucherCode, @purchasedAt, @expiresAt
        )
      `);

    const inventoryId = inventoryResult.recordset[0].InventoryID;

    // Deduct coins from client balance
    const updateBalanceReq = new sql.Request(transaction);
    await updateBalanceReq
      .input("clientId", sql.Int, clientId)
      .input("amount", sql.Decimal(18, 2), item.priceCoins).query(`
        UPDATE [dbo].[TblClientLoyalty]
        SET PointsBalance = PointsBalance - @amount,
            UpdatedAt = GETDATE()
        WHERE ClientID = @clientId
      `);

    // Add ledger entry
    const idempotencyKey = `STORE-${clientId}-${itemId}-${Date.now()}`;
    const ledgerReq = new sql.Request(transaction);
    await ledgerReq
      .input("clientId", sql.Int, clientId)
      .input("movementType", sql.NVarChar(20), "STORE_PURCHASE")
      .input("pointsDelta", sql.Decimal(10, 2), -item.priceCoins)
      .input("pointsBefore", sql.Decimal(10, 2), balance)
      .input("pointsAfter", sql.Decimal(10, 2), balance - item.priceCoins)
      .input("notes", sql.NVarChar(500), `Store purchase: ${item.nameAr}`)
      .input("idempotencyKey", sql.NVarChar(100), idempotencyKey)
      .query(`
        INSERT INTO [dbo].[TblLoyaltyPointLedger] (
          ClientID, ClientLoyaltyID, MovementType, PointsDelta, PointsBefore, PointsAfter, Notes, IdempotencyKey, CreatedAt
        )
        SELECT 
          @clientId,
          ClientLoyaltyID,
          @movementType,
          @pointsDelta,
          @pointsBefore,
          @pointsAfter,
          @notes,
          @idempotencyKey,
          GETDATE()
        FROM [dbo].[TblClientLoyalty]
        WHERE ClientID = @clientId
      `);

    // Update stock if not unlimited — use UPDLOCK to prevent race conditions
    if (!item.unlimitedStock) {
      const updateStockReq = new sql.Request(transaction);
      const stockResult = await updateStockReq.input("itemId", sql.Int, itemId).query(`
        UPDATE [dbo].[TblLoyaltyStoreItem]
        SET StockQuantity = StockQuantity - 1,
            UpdatedAt = GETDATE()
        OUTPUT INSERTED.StockQuantity
        WHERE ItemID = @itemId
          AND UnlimitedStock = 0
          AND ISNULL(StockQuantity, 0) > 0
      `);
      if (stockResult.rowsAffected[0] === 0) {
        throw new Error("هذا العنصر غير متوفر في المخزون");
      }
    }

    await transaction.commit();

    return {
      success: true,
      inventoryId,
      voucherCode,
      expiresAt,
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

// ============================================
// Decrease Stock Quantity
// ============================================
export async function decreaseStockQuantity(
  itemId: number,
  quantity: number = 1,
): Promise<void> {
  const db = await getPool();

  await db
    .request()
    .input("itemId", sql.Int, itemId)
    .input("quantity", sql.Int, quantity).query(`
    UPDATE [dbo].[TblLoyaltyStoreItem]
    SET StockQuantity = StockQuantity - @quantity,
        UpdatedAt = GETDATE()
    WHERE ItemID = @itemId 
      AND UnlimitedStock = 0 
      AND StockQuantity >= @quantity
  `);
}

// ============================================
// ADMIN: Get All Store Items (including inactive)
// ============================================
export async function getAllStoreItemsAdmin(
  filters?: {
    isActive?: boolean | null;
    categoryId?: number | null;
    itemType?: string | null;
    search?: string | null;
  },
): Promise<StoreItem[]> {
  const db = await getPool();

  const conditions: string[] = [];
  const req = db.request();

  if (filters?.isActive !== undefined && filters.isActive !== null) {
    conditions.push("si.IsActive = @isActive");
    req.input("isActive", sql.Bit, filters.isActive ? 1 : 0);
  }
  if (filters?.categoryId) {
    conditions.push("si.CategoryID = @categoryId");
    req.input("categoryId", sql.Int, filters.categoryId);
  }
  if (filters?.itemType) {
    conditions.push("si.ItemType = @itemType");
    req.input("itemType", sql.NVarChar(50), filters.itemType);
  }
  if (filters?.search) {
    conditions.push("(si.NameAr LIKE @search OR si.NameEn LIKE @search OR si.Code LIKE @search)");
    req.input("search", sql.NVarChar(200), `%${filters.search}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `
    SELECT 
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
      si.CreatedAt,
      si.UpdatedAt
    FROM [dbo].[TblLoyaltyStoreItem] si
    LEFT JOIN [dbo].[TblLoyaltyTier] lt ON lt.TierID = si.MinTierID
    ${whereClause}
    ORDER BY si.SortOrder, si.ItemID
  `;

  const result = await req.query<RawStoreItemFromDb>(query);
  return result.recordset.map(mapDbStoreItemToApi);
}

// ============================================
// ADMIN: Create Store Item
// ============================================
export async function createStoreItem(
  data: Omit<StoreItem, "itemId" | "createdAt" | "updatedAt">,
): Promise<StoreItem> {
  const db = await getPool();

  // Resolve MinTierID from MinTierCode
  let minTierId: number | null = null;
  if (data.minTierCode) {
    const tierResult = await db
      .request()
      .input("tierCode", sql.NVarChar(50), data.minTierCode)
      .query(`SELECT TierID FROM [dbo].[TblLoyaltyTier] WHERE TierCode = @tierCode`);
    if (tierResult.recordset.length > 0) {
      minTierId = tierResult.recordset[0].TierID;
    }
  }

  const result = await db
    .request()
    .input("categoryId", sql.Int, data.categoryId)
    .input("code", sql.NVarChar(50), data.code)
    .input("nameAr", sql.NVarChar(200), data.nameAr)
    .input("nameEn", sql.NVarChar(200), data.nameEn)
    .input("descriptionAr", sql.NVarChar(500), data.descriptionAr || "")
    .input("descriptionEn", sql.NVarChar(500), data.descriptionEn || "")
    .input("itemType", sql.NVarChar(50), data.itemType)
    .input("priceCoins", sql.Decimal(18, 2), data.priceCoins)
    .input("value", sql.Decimal(18, 2), data.value)
    .input("serviceId", sql.Int, data.serviceId)
    .input("productId", sql.Int, data.productId)
    .input("minTierId", sql.Int, minTierId)
    .input("stockQuantity", sql.Int, data.stockQuantity)
    .input("unlimitedStock", sql.Bit, data.unlimitedStock ? 1 : 0)
    .input("expiresAfterDays", sql.Int, data.expiresAfterDays)
    .input("imageUrl", sql.NVarChar(500), data.imageUrl)
    .input("badgeText", sql.NVarChar(100), data.badgeText)
    .input("isFeatured", sql.Bit, data.isFeatured ? 1 : 0)
    .input("isActive", sql.Bit, data.isActive ? 1 : 0)
    .input("sortOrder", sql.Int, data.sortOrder).query(`
      INSERT INTO [dbo].[TblLoyaltyStoreItem] (
        CategoryID, Code, NameAr, NameEn, DescriptionAr, DescriptionEn,
        ItemType, PriceCoins, Value, ServiceID, ProductID, MinTierID,
        StockQuantity, UnlimitedStock, ExpiresAfterDays, ImageUrl, BadgeText,
        IsFeatured, IsActive, SortOrder, CreatedAt
      )
      OUTPUT INSERTED.ItemID
      VALUES (
        @categoryId, @code, @nameAr, @nameEn, @descriptionAr, @descriptionEn,
        @itemType, @priceCoins, @value, @serviceId, @productId, @minTierId,
        @stockQuantity, @unlimitedStock, @expiresAfterDays, @imageUrl, @badgeText,
        @isFeatured, @isActive, @sortOrder, GETDATE()
      )
    `);

  const itemId = result.recordset[0].ItemID;
  const item = await getStoreItemById(itemId);
  if (!item) throw new Error("Failed to retrieve created item");
  return item;
}

// ============================================
// ADMIN: Update Store Item
// ============================================
export async function updateStoreItem(
  itemId: number,
  data: Partial<Omit<StoreItem, "itemId" | "createdAt" | "updatedAt">>,
): Promise<StoreItem | null> {
  if (!isValidItemId(itemId)) {
    throw new Error("Invalid item ID");
  }

  const db = await getPool();

  const updateFields: string[] = [];
  const req = db.request();

  if (data.categoryId !== undefined) {
    updateFields.push("CategoryID = @categoryId");
    req.input("categoryId", sql.Int, data.categoryId);
  }
  if (data.code !== undefined) {
    updateFields.push("Code = @code");
    req.input("code", sql.NVarChar(50), data.code);
  }
  if (data.nameAr !== undefined) {
    updateFields.push("NameAr = @nameAr");
    req.input("nameAr", sql.NVarChar(200), data.nameAr);
  }
  if (data.nameEn !== undefined) {
    updateFields.push("NameEn = @nameEn");
    req.input("nameEn", sql.NVarChar(200), data.nameEn);
  }
  if (data.descriptionAr !== undefined) {
    updateFields.push("DescriptionAr = @descriptionAr");
    req.input("descriptionAr", sql.NVarChar(500), data.descriptionAr);
  }
  if (data.descriptionEn !== undefined) {
    updateFields.push("DescriptionEn = @descriptionEn");
    req.input("descriptionEn", sql.NVarChar(500), data.descriptionEn);
  }
  if (data.itemType !== undefined) {
    updateFields.push("ItemType = @itemType");
    req.input("itemType", sql.NVarChar(50), data.itemType);
  }
  if (data.priceCoins !== undefined) {
    updateFields.push("PriceCoins = @priceCoins");
    req.input("priceCoins", sql.Decimal(18, 2), data.priceCoins);
  }
  if (data.value !== undefined) {
    updateFields.push("Value = @value");
    req.input("value", sql.Decimal(18, 2), data.value);
  }
  if (data.serviceId !== undefined) {
    updateFields.push("ServiceID = @serviceId");
    req.input("serviceId", sql.Int, data.serviceId);
  }
  if (data.productId !== undefined) {
    updateFields.push("ProductID = @productId");
    req.input("productId", sql.Int, data.productId);
  }
  if (data.minTierCode !== undefined) {
    if (data.minTierCode === null) {
      updateFields.push("MinTierID = NULL");
    } else {
      const tierResult = await db
        .request()
        .input("tierCode", sql.NVarChar(50), data.minTierCode)
        .query(`SELECT TierID FROM [dbo].[TblLoyaltyTier] WHERE TierCode = @tierCode`);
      const minTierId = tierResult.recordset.length > 0 ? tierResult.recordset[0].TierID : null;
      updateFields.push("MinTierID = @minTierId");
      req.input("minTierId", sql.Int, minTierId);
    }
  }
  if (data.stockQuantity !== undefined) {
    updateFields.push("StockQuantity = @stockQuantity");
    req.input("stockQuantity", sql.Int, data.stockQuantity);
  }
  if (data.unlimitedStock !== undefined) {
    updateFields.push("UnlimitedStock = @unlimitedStock");
    req.input("unlimitedStock", sql.Bit, data.unlimitedStock ? 1 : 0);
  }
  if (data.expiresAfterDays !== undefined) {
    updateFields.push("ExpiresAfterDays = @expiresAfterDays");
    req.input("expiresAfterDays", sql.Int, data.expiresAfterDays);
  }
  if (data.imageUrl !== undefined) {
    updateFields.push("ImageUrl = @imageUrl");
    req.input("imageUrl", sql.NVarChar(500), data.imageUrl);
  }
  if (data.badgeText !== undefined) {
    updateFields.push("BadgeText = @badgeText");
    req.input("badgeText", sql.NVarChar(100), data.badgeText);
  }
  if (data.isFeatured !== undefined) {
    updateFields.push("IsFeatured = @isFeatured");
    req.input("isFeatured", sql.Bit, data.isFeatured ? 1 : 0);
  }
  if (data.isActive !== undefined) {
    updateFields.push("IsActive = @isActive");
    req.input("isActive", sql.Bit, data.isActive ? 1 : 0);
  }
  if (data.sortOrder !== undefined) {
    updateFields.push("SortOrder = @sortOrder");
    req.input("sortOrder", sql.Int, data.sortOrder);
  }

  if (updateFields.length === 0) {
    return getStoreItemById(itemId);
  }

  updateFields.push("UpdatedAt = GETDATE()");
  req.input("itemId", sql.Int, itemId);

  await req.query(`
    UPDATE [dbo].[TblLoyaltyStoreItem]
    SET ${updateFields.join(", ")}
    WHERE ItemID = @itemId
  `);

  return getStoreItemById(itemId);
}

// ============================================
// ADMIN: Delete Store Item (soft delete)
// ============================================
export async function deleteStoreItem(itemId: number): Promise<boolean> {
  if (!isValidItemId(itemId)) {
    throw new Error("Invalid item ID");
  }

  const db = await getPool();

  const result = await db
    .request()
    .input("itemId", sql.Int, itemId)
    .query(`
      UPDATE [dbo].[TblLoyaltyStoreItem]
      SET IsActive = 0, UpdatedAt = GETDATE()
      WHERE ItemID = @itemId
    `);

  return (result.rowsAffected?.[0] ?? 0) > 0;
}

// ============================================
// ADMIN: Update Stock
// ============================================
export async function updateStoreItemStock(
  itemId: number,
  stockQuantity: number | null,
  unlimitedStock: boolean,
): Promise<boolean> {
  if (!isValidItemId(itemId)) {
    throw new Error("Invalid item ID");
  }

  const db = await getPool();

  const result = await db
    .request()
    .input("itemId", sql.Int, itemId)
    .input("stockQuantity", sql.Int, stockQuantity)
    .input("unlimitedStock", sql.Bit, unlimitedStock ? 1 : 0)
    .query(`
      UPDATE [dbo].[TblLoyaltyStoreItem]
      SET StockQuantity = @stockQuantity,
          UnlimitedStock = @unlimitedStock,
          UpdatedAt = GETDATE()
      WHERE ItemID = @itemId
    `);

  return (result.rowsAffected?.[0] ?? 0) > 0;
}

// ============================================
// ADMIN: Get All Categories (including inactive)
// ============================================
export async function getStoreCategoriesAdmin(): Promise<StoreCategory[]> {
  const db = await getPool();

  const result = await db.request().query(`
    SELECT 
      CategoryID,
      SalonID,
      Code,
      NameAr,
      NameEn,
      DescriptionAr,
      DescriptionEn,
      Icon,
      SortOrder,
      IsActive,
      CreatedAt,
      UpdatedAt
    FROM [dbo].[TblLoyaltyStoreCategory]
    ORDER BY SortOrder, CategoryID
  `);

  return result.recordset.map(mapDbCategoryToApi);
}

// ============================================
// ADMIN: Create Category
// ============================================
export async function createStoreCategory(
  data: Omit<StoreCategory, "categoryId">,
): Promise<StoreCategory> {
  const db = await getPool();

  const result = await db
    .request()
    .input("code", sql.NVarChar(50), data.code)
    .input("nameAr", sql.NVarChar(200), data.nameAr)
    .input("nameEn", sql.NVarChar(200), data.nameEn)
    .input("descriptionAr", sql.NVarChar(500), data.descriptionAr)
    .input("descriptionEn", sql.NVarChar(500), data.descriptionEn)
    .input("icon", sql.NVarChar(100), data.icon)
    .input("sortOrder", sql.Int, data.sortOrder)
    .input("isActive", sql.Bit, data.isActive ? 1 : 0).query(`
      INSERT INTO [dbo].[TblLoyaltyStoreCategory] (
        Code, NameAr, NameEn, DescriptionAr, DescriptionEn, Icon, SortOrder, IsActive, CreatedAt
      )
      OUTPUT INSERTED.CategoryID
      VALUES (
        @code, @nameAr, @nameEn, @descriptionAr, @descriptionEn, @icon, @sortOrder, @isActive, GETDATE()
      )
    `);

  const categoryId = result.recordset[0].CategoryID;
  const categories = await getStoreCategoriesAdmin();
  return categories.find((c) => c.categoryId === categoryId)!;
}

// ============================================
// ADMIN: Update Category
// ============================================
export async function updateStoreCategory(
  categoryId: number,
  data: Partial<Omit<StoreCategory, "categoryId">>,
): Promise<StoreCategory | null> {
  const db = await getPool();

  const updateFields: string[] = [];
  const req = db.request();

  if (data.code !== undefined) {
    updateFields.push("Code = @code");
    req.input("code", sql.NVarChar(50), data.code);
  }
  if (data.nameAr !== undefined) {
    updateFields.push("NameAr = @nameAr");
    req.input("nameAr", sql.NVarChar(200), data.nameAr);
  }
  if (data.nameEn !== undefined) {
    updateFields.push("NameEn = @nameEn");
    req.input("nameEn", sql.NVarChar(200), data.nameEn);
  }
  if (data.descriptionAr !== undefined) {
    updateFields.push("DescriptionAr = @descriptionAr");
    req.input("descriptionAr", sql.NVarChar(500), data.descriptionAr);
  }
  if (data.descriptionEn !== undefined) {
    updateFields.push("DescriptionEn = @descriptionEn");
    req.input("descriptionEn", sql.NVarChar(500), data.descriptionEn);
  }
  if (data.icon !== undefined) {
    updateFields.push("Icon = @icon");
    req.input("icon", sql.NVarChar(100), data.icon);
  }
  if (data.sortOrder !== undefined) {
    updateFields.push("SortOrder = @sortOrder");
    req.input("sortOrder", sql.Int, data.sortOrder);
  }
  if (data.isActive !== undefined) {
    updateFields.push("IsActive = @isActive");
    req.input("isActive", sql.Bit, data.isActive ? 1 : 0);
  }

  if (updateFields.length === 0) {
    const cats = await getStoreCategoriesAdmin();
    return cats.find((c) => c.categoryId === categoryId) ?? null;
  }

  updateFields.push("UpdatedAt = GETDATE()");
  req.input("categoryId", sql.Int, categoryId);

  await req.query(`
    UPDATE [dbo].[TblLoyaltyStoreCategory]
    SET ${updateFields.join(", ")}
    WHERE CategoryID = @categoryId
  `);

  const cats = await getStoreCategoriesAdmin();
  return cats.find((c) => c.categoryId === categoryId) ?? null;
}

// ============================================
// ADMIN: Delete Category (soft delete)
// ============================================
export async function deleteStoreCategory(categoryId: number): Promise<boolean> {
  const db = await getPool();

  const result = await db
    .request()
    .input("categoryId", sql.Int, categoryId)
    .query(`
      UPDATE [dbo].[TblLoyaltyStoreCategory]
      SET IsActive = 0, UpdatedAt = GETDATE()
      WHERE CategoryID = @categoryId
    `);

  return (result.rowsAffected?.[0] ?? 0) > 0;
}

// ============================================
// ADMIN: Get Store Stats
// ============================================
export async function getStoreStats(): Promise<{
  totalItems: number;
  activeItems: number;
  inactiveItems: number;
  featuredItems: number;
  outOfStockItems: number;
  totalCategories: number;
  activeCategories: number;
  totalPurchases: number;
  totalInventoryItems: number;
}> {
  const db = await getPool();

  const result = await db.request().query(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[TblLoyaltyStoreItem]) as totalItems,
      (SELECT COUNT(*) FROM [dbo].[TblLoyaltyStoreItem] WHERE IsActive = 1) as activeItems,
      (SELECT COUNT(*) FROM [dbo].[TblLoyaltyStoreItem] WHERE IsActive = 0) as inactiveItems,
      (SELECT COUNT(*) FROM [dbo].[TblLoyaltyStoreItem] WHERE IsFeatured = 1 AND IsActive = 1) as featuredItems,
      (SELECT COUNT(*) FROM [dbo].[TblLoyaltyStoreItem] WHERE IsActive = 1 AND UnlimitedStock = 0 AND ISNULL(StockQuantity, 0) = 0) as outOfStockItems,
      (SELECT COUNT(*) FROM [dbo].[TblLoyaltyStoreCategory]) as totalCategories,
      (SELECT COUNT(*) FROM [dbo].[TblLoyaltyStoreCategory] WHERE IsActive = 1) as activeCategories,
      (SELECT COUNT(*) FROM [dbo].[TblClientInventory]) as totalPurchases,
      (SELECT COUNT(*) FROM [dbo].[TblClientInventory] WHERE Status = 'ACTIVE') as totalInventoryItems
  `);

  const row = result.recordset[0];
  return {
    totalItems: row.totalItems,
    activeItems: row.activeItems,
    inactiveItems: row.inactiveItems,
    featuredItems: row.featuredItems,
    outOfStockItems: row.outOfStockItems,
    totalCategories: row.totalCategories,
    activeCategories: row.activeCategories,
    totalPurchases: row.totalPurchases,
    totalInventoryItems: row.totalInventoryItems,
  };
}

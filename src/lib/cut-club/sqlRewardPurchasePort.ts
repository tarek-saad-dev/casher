/**
 * CUT CLUB — SQL Server adapter for reward purchase settlement (ported from #320).
 * Never constructs a pool on import. Transaction, row locks and idempotency
 * live in SQL Server. Requires DRVO migration 027 (CutClubRewardCommand).
 * Store items with SalonID NULL are offered in every salon of the tenant.
 */
import { sql } from "@/lib/db";
import type { ConnectionPool } from "mssql";
import type {
  MemberBalanceForPurchase, RewardItemForPurchase,
  RewardOwner, RewardPurchasePort, RewardPurchaseTransaction,
  StoredPurchaseCommand, PurchaseReceipt,
} from "./rewardSettlement";

export function createSqlRewardPurchasePort(pool: ConnectionPool): RewardPurchasePort {
  return {
    async serializable<T>(work: (tx: RewardPurchaseTransaction) => Promise<T>): Promise<T> {
      const transaction = new sql.Transaction(pool);
      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        const tx: RewardPurchaseTransaction = {
          async lockMember(owner) {
            const r = await new sql.Request(transaction)
              .input("lockName", sql.NVarChar(180), `CUTCLUB:SPEND:${owner.tenantId}:${owner.customerId}`)
              .query(`
                DECLARE @result INT;
                EXEC @result = sp_getapplock
                  @Resource=@lockName, @LockMode='Exclusive',
                  @LockOwner='Transaction', @LockTimeout=3000;
                SELECT @result AS LockResult;
              `);
            return (r.recordset?.length ?? 0) === 1 && Number(r.recordset[0].LockResult) >= 0;
          },

          async findCommand(owner, idempotencyKey): Promise<StoredPurchaseCommand | null> {
            const r = await new sql.Request(transaction)
              .input("tenantId", sql.UniqueIdentifier, owner.tenantId)
              .input("clientId", sql.Int, owner.customerId)
              .input("salonId", sql.Int, owner.salonId)
              .input("key", sql.VarChar(64), idempotencyKey)
              .query(`
                SELECT TOP (1) ItemId, InventoryId, CoinsCharged,
                               BalanceAfter, VoucherCode
                FROM dbo.CutClubRewardCommand WITH (UPDLOCK, HOLDLOCK)
                WHERE TenantId=@tenantId AND CustomerId=@clientId
                  AND SalonId=@salonId AND IdempotencyKey=@key;
              `);
            if (r.recordset.length === 0) return null;
            const row = r.recordset[0];
            return {
              itemId: row.ItemId,
              receipt: {
                itemId: row.ItemId,
                inventoryId: row.InventoryId,
                coinsCharged: row.CoinsCharged,
                balanceAfter: row.BalanceAfter,
                voucherCode: row.VoucherCode,
              },
            };
          },

          async findPublishedItem(owner, itemId): Promise<RewardItemForPurchase | null> {
            const r = await new sql.Request(transaction)
              .input("itemId", sql.Int, itemId)
              .input("salonId", sql.Int, owner.salonId)
              .query(`
                SELECT TOP (1) si.ItemID, si.PriceCoins, si.IsActive,
                       si.ItemType, si.ServiceID,
                       si.UnlimitedStock, si.ExpiresAfterDays,
                       COALESCE(requiredTier.SortOrder, 1) AS RequiredTierRank
                FROM dbo.TblLoyaltyStoreItem AS si WITH (UPDLOCK, HOLDLOCK)
                LEFT JOIN dbo.TblLoyaltyTier AS requiredTier
                  ON requiredTier.TierID = si.MinTierID AND requiredTier.IsActive = 1
                WHERE si.ItemID=@itemId AND (si.SalonID=@salonId OR si.SalonID IS NULL) AND si.IsActive=1;
              `);
            if (r.recordset.length !== 1) return null;
            const row = r.recordset[0];
            return {
              itemId: row.ItemID,
              priceCoins: row.PriceCoins,
              isActive: row.IsActive === true,
              itemType: row.ItemType,
              serviceId: row.ServiceID,
              requiresTierRank: row.RequiredTierRank,
              unlimitedStock: row.UnlimitedStock === true,
              expiresAfterDays: row.ExpiresAfterDays,
            };
          },

          async lockMemberBalance(owner): Promise<MemberBalanceForPurchase | null> {
            const r = await new sql.Request(transaction)
              .input("clientId", sql.Int, owner.customerId)
              .query(`
                SELECT TOP (2) cl.ClientLoyaltyID, cl.PointsBalance,
                       tier.SortOrder AS TierRank
                FROM dbo.TblClientLoyalty AS cl WITH (UPDLOCK, HOLDLOCK)
                JOIN dbo.TblLoyaltyTier AS tier
                  ON tier.TierID = cl.TierID AND tier.IsActive=1
                WHERE cl.ClientID=@clientId AND cl.IsActive=1;
              `);
            if (r.recordset.length !== 1) return null;
            const row = r.recordset[0];
            return {
              clientLoyaltyId: row.ClientLoyaltyID,
              balanceCoins: row.PointsBalance,
              tierRank: row.TierRank,
            };
          },

          async reserveOneStock(owner, itemId) {
            const r = await new sql.Request(transaction)
              .input("salonId", sql.Int, owner.salonId)
              .input("itemId", sql.Int, itemId)
              .query(`
                UPDATE dbo.TblLoyaltyStoreItem
                SET StockQuantity=StockQuantity-1, UpdatedAt=GETDATE()
                WHERE ItemID=@itemId AND (SalonID=@salonId OR SalonID IS NULL) AND IsActive=1
                  AND UnlimitedStock=0 AND StockQuantity > 0;
              `);
            return r.rowsAffected?.[0] === 1;
          },

          async debitCoins(owner, loyaltyId, amount) {
            const r = await new sql.Request(transaction)
              .input("clientId", sql.Int, owner.customerId)
              .input("loyaltyId", sql.Int, loyaltyId)
              .input("priceCoins", sql.Decimal(18, 2), amount)
              .query(`
                UPDATE dbo.TblClientLoyalty
                SET PointsBalance=PointsBalance-@priceCoins,
                    LifetimeRedeemedPoints=ISNULL(LifetimeRedeemedPoints,0)+@priceCoins,
                    UpdatedAt=GETDATE()
                OUTPUT DELETED.PointsBalance AS BeforeBalance,
                       INSERTED.PointsBalance AS AfterBalance
                WHERE ClientID=@clientId AND ClientLoyaltyID=@loyaltyId
                  AND IsActive=1 AND PointsBalance>=@priceCoins;
              `);
            if (r.recordset.length !== 1) return null;
            return { before: r.recordset[0].BeforeBalance, after: r.recordset[0].AfterBalance };
          },

          async createLedger(owner, input) {
            const r = await new sql.Request(transaction)
              .input("clientId", sql.Int, owner.customerId)
              .input("loyaltyId", sql.Int, input.clientLoyaltyId)
              .input("amount", sql.Decimal(18, 2), -input.priceCoins)
              .input("beforeBalance", sql.Decimal(18, 2), input.before)
              .input("afterBalance", sql.Decimal(18, 2), input.after)
              .input("idempotencyKey", sql.NVarChar(100), "CLUB2-" + input.idempotencyKey)
              .query(`
                INSERT INTO dbo.TblLoyaltyPointLedger (
                  ClientID, ClientLoyaltyID, MovementType, PointsDelta,
                  PointsBefore, PointsAfter, IdempotencyKey, CreatedAt
                )
                VALUES (@clientId, @loyaltyId, N'STORE_PURCHASE', @amount,
                        @beforeBalance, @afterBalance, @idempotencyKey, GETDATE());
              `);
            return r.rowsAffected?.[0] === 1;
          },

          async createOwnedVoucher(owner, input) {
            const r = await new sql.Request(transaction)
              .input("clientId", sql.Int, owner.customerId)
              .input("itemId", sql.Int, input.itemId)
              .input("priceCoins", sql.Decimal(18, 2), input.priceCoins)
              .input("code", sql.VarChar(100), input.voucherCode)
              .input("expiresAt", sql.DateTime2, input.expiresAt)
              .query(`
                INSERT INTO dbo.TblClientInventory (
                  ClientID, ItemID, Quantity, Status, PurchasePriceCoins,
                  VoucherCode, PurchasedAt, ExpiresAt
                )
                OUTPUT INSERTED.InventoryID
                VALUES (@clientId, @itemId, 1, N'ACTIVE', @priceCoins,
                        @code, GETDATE(), @expiresAt);
              `);
            return r.recordset.length === 1 ? r.recordset[0].InventoryID : null;
          },

          async recordCommand(owner, idempotencyKey, receipt: PurchaseReceipt) {
            const r = await new sql.Request(transaction)
              .input("tenantId", sql.UniqueIdentifier, owner.tenantId)
              .input("clientId", sql.Int, owner.customerId)
              .input("salonId", sql.Int, owner.salonId)
              .input("key", sql.VarChar(64), idempotencyKey)
              .input("itemId", sql.Int, receipt.itemId)
              .input("inventoryId", sql.Int, receipt.inventoryId)
              .input("priceCoins", sql.Decimal(18, 2), receipt.coinsCharged)
              .input("balanceAfter", sql.Decimal(18, 2), receipt.balanceAfter)
              .input("code", sql.VarChar(100), receipt.voucherCode)
              .query(`
                INSERT INTO dbo.CutClubRewardCommand (
                  TenantId, CustomerId, SalonId, IdempotencyKey,
                  ItemId, InventoryId, CoinsCharged, BalanceAfter, VoucherCode
                )
                VALUES (@tenantId, @clientId, @salonId, @key,
                        @itemId, @inventoryId, @priceCoins, @balanceAfter, @code);
              `);
            return r.rowsAffected?.[0] === 1;
          },
        };
        const result = await work(tx);
        await transaction.commit();
        return result;
      } catch (error) {
        try { await transaction.rollback(); } catch { /* original error wins */ }
        throw error;
      }
    },
  };
}

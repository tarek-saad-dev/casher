/**
 * CUT CLUB V2 — SQL Server transaction adapter for future secure reward writes.
 *
 * NOT attached to a public route and NEVER constructs a pool on import.
 * Transaction, row locks and idempotency live in SQL Server (not local JS).
 * Expects manually reviewed CutClubRewardCommand staging migration first.
 * Tenant->legacy client/salon authority MUST be established by caller.
 */
import 'server-only';
import sql from "mssql";
import type {
  MemberBalanceForPurchase, RewardItemForPurchase,
  RewardOwner, RewardPurchasePort, RewardPurchaseTransaction,
  StoredPurchaseCommand, PurchaseReceipt,
} from "./stagingRewardSettlement";

export const STAGE_REWARD_DB='last132_agent';
export const STAGE_REWARD_LOGIN='drvo_agent';
/** Both pool preflight and in-transaction guard are mandatory; enabling an env
 * flag or accidentally connecting to last132 can NEVER unlock money writes. */
export async function stageRewardPoolReady(pool:sql.ConnectionPool):Promise<boolean>{
  const r=await pool.request().query<{DbName:string;LoginName:string;HasCommand:number}>(`
    SELECT DB_NAME() AS DbName,SUSER_SNAME() AS LoginName,
      CASE WHEN OBJECT_ID(N'dbo.CutClubRewardCommand',N'U') IS NOT NULL THEN 1 ELSE 0 END AS HasCommand
  `);
  return r.recordset.length===1 && r.recordset[0].DbName===STAGE_REWARD_DB
    && r.recordset[0].LoginName===STAGE_REWARD_LOGIN
    && r.recordset[0].HasCommand===1;
}
export function createStageSqlRewardPurchasePort(pool: sql.ConnectionPool): RewardPurchasePort {
  return {
    async serializable<T>(work: (tx: RewardPurchaseTransaction) => Promise<T>): Promise<T> {
      const transaction = new sql.Transaction(pool);
      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        if(process.env.CUT_CLUB_STAGING_REWARD_PURCHASE_ENABLED!=='true')
          throw Error('CUT_CLUB_STAGING_REWARD_WRITES_DISABLED');
        const ctx=await new sql.Request(transaction).query<{DbName:string;LoginName:string;HasCommand:number}>(`
          SELECT DB_NAME() AS DbName,SUSER_SNAME() AS LoginName,
            CASE WHEN OBJECT_ID(N'dbo.CutClubRewardCommand',N'U') IS NOT NULL THEN 1 ELSE 0 END AS HasCommand
        `);
        const stamp=ctx.recordset[0];
        if(ctx.recordset.length!==1||stamp.DbName!==STAGE_REWARD_DB||
           stamp.LoginName!==STAGE_REWARD_LOGIN||stamp.HasCommand!==1)
          throw Error('CUT_CLUB_STAGING_DB_CONTEXT_DENIED');
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
              .input("branchId", sql.Int, owner.branchId)
              .input("key", sql.VarChar(64), idempotencyKey)
              .query(`
                SELECT TOP (1) ItemId, InventoryId, CoinsCharged,
                               BalanceAfter, VoucherCode
                FROM dbo.CutClubRewardCommand WITH (UPDLOCK, HOLDLOCK)
                WHERE TenantId=@tenantId AND CustomerId=@clientId
                  AND BranchId=@branchId AND IdempotencyKey=@key;
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
            // Only service entitlements owner-approved for CUT Salon. No
            // production ServiceID seeding, hidden branch mapping or guessing.
            const r=await new sql.Request(transaction)
              .input('itemId',sql.Int,itemId)
              .input('tenantId',sql.UniqueIdentifier,owner.tenantId)
              .query(`
                SELECT TOP (2) si.ItemID,si.PriceCoins,si.IsActive,
                  si.UnlimitedStock,si.ExpiresAfterDays,
                  COALESCE(requiredTier.SortOrder,1) AS RequiredTierRank
                FROM dbo.TblLoyaltyStoreItem si WITH (UPDLOCK,HOLDLOCK)
                INNER JOIN dbo.TblPro p ON p.ProID=si.ServiceID
                  AND p.TenantId=@tenantId AND p.isDeleted=0
                LEFT JOIN dbo.TblLoyaltyTier requiredTier
                  ON requiredTier.TierID=si.MinTierID AND requiredTier.IsActive=1
                WHERE si.ItemID=@itemId AND si.ItemID IN (15,16,17,18)
                  AND si.SalonID IS NULL AND si.IsActive=1
                  AND si.ItemType='FREE_SERVICE'
                  AND si.ServiceID=(CASE si.ItemID
                    WHEN 15 THEN 39 WHEN 16 THEN 22
                    WHEN 17 THEN 11 WHEN 18 THEN 9 END)
              `);
            if(r.recordset.length!==1)return null;
            const x=r.recordset[0];
            return {itemId:x.ItemID,priceCoins:Number(x.PriceCoins),
              isActive:x.IsActive===true,requiresTierRank:Number(x.RequiredTierRank),
              unlimitedStock:x.UnlimitedStock===true,expiresAfterDays:x.ExpiresAfterDays};
          },

          async lockMemberBalance(owner): Promise<MemberBalanceForPurchase | null> {
            const r=await new sql.Request(transaction)
              .input('tenantId',sql.UniqueIdentifier,owner.tenantId)
              .input('clientId',sql.Int,owner.customerId)
              .query(`
                SELECT TOP (2) l.ClientLoyaltyID,l.PointsBalance,
                  tier.SortOrder AS TierRank
                FROM dbo.TblClient c WITH (UPDLOCK,HOLDLOCK)
                JOIN dbo.TblClientLoyalty l WITH (UPDLOCK,HOLDLOCK)
                  ON l.ClientID=c.ClientID AND l.IsActive=1
                JOIN dbo.TblLoyaltyTier tier ON tier.TierID=l.TierID AND tier.IsActive=1
                WHERE c.ClientID=@clientId AND c.TenantId=@tenantId
              `);
            if(r.recordset.length!==1)return null;
            const x=r.recordset[0];
            return {clientLoyaltyId:x.ClientLoyaltyID,
              balanceCoins:Number(x.PointsBalance),tierRank:Number(x.TierRank)};
          },

          async reserveOneStock(owner, itemId) {
            const r = await new sql.Request(transaction)
              .input("branchId", sql.Int, owner.branchId)
              .input("itemId", sql.Int, itemId)
              .query(`
                UPDATE dbo.TblLoyaltyStoreItem
                SET StockQuantity=StockQuantity-1, UpdatedAt=GETDATE()
                WHERE ItemID=@itemId AND ItemID IN (15,16,17,18)
                  AND SalonID IS NULL AND IsActive=1
                  AND UnlimitedStock=0 AND StockQuantity > 0;
              `);
            return r.rowsAffected?.[0] === 1;
          },

          async debitCoins(owner, loyaltyId, amount) {
            const r = await new sql.Request(transaction)
              .input("clientId", sql.Int, owner.customerId)
              .input("loyaltyId", sql.Int, loyaltyId)
              .input("tenantId", sql.UniqueIdentifier, owner.tenantId)
              .input("priceCoins", sql.Decimal(18, 2), amount)
              .query(`
                UPDATE dbo.TblClientLoyalty
                SET PointsBalance=PointsBalance-@priceCoins, UpdatedAt=GETDATE()
                OUTPUT DELETED.PointsBalance AS BeforeBalance,
                       INSERTED.PointsBalance AS AfterBalance
                WHERE ClientID=@clientId AND ClientLoyaltyID=@loyaltyId
                  AND IsActive=1 AND PointsBalance>=@priceCoins
                  AND EXISTS (SELECT 1 FROM dbo.TblClient
                    WHERE ClientID=@clientId AND TenantId=@tenantId);
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
              .input("branchId", sql.Int, owner.branchId)
              .input("key", sql.VarChar(64), idempotencyKey)
              .input("itemId", sql.Int, receipt.itemId)
              .input("inventoryId", sql.Int, receipt.inventoryId)
              .input("priceCoins", sql.Decimal(18, 2), receipt.coinsCharged)
              .input("balanceAfter", sql.Decimal(18, 2), receipt.balanceAfter)
              .input("code", sql.VarChar(100), receipt.voucherCode)
              .query(`
                INSERT INTO dbo.CutClubRewardCommand (
                  TenantId, CustomerId, BranchId, IdempotencyKey,
                  ItemId, InventoryId, CoinsCharged, BalanceAfter, VoucherCode
                )
                VALUES (@tenantId, @clientId, @branchId, @key,
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

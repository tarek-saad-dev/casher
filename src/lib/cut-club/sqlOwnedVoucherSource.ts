/**
 * CUT CLUB — private voucher SQL read for verified customer session only.
 * No global SQL pool created, no public routes, no customer chosen by phone.
 * Tenant/customer authority is re-checked on EACH read by SQL predicate
 * AND by an independently trusted membership resolver.
 */
import sql from "mssql";
import type { OwnedVoucherRecord, OwnedVoucherSource, VoucherOwner } from "./clientVoucherHandoff";

const validOwner = (key: VoucherOwner) =>
  typeof key.tenantId === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(key.tenantId) &&
  Number.isSafeInteger(key.customerId) && key.customerId > 0;

export function createSqlOwnedVoucherSource(input: Readonly<{
  pool: sql.ConnectionPool;
  /** Authoritative server-side Tenant+Customer membership mapping. */
  verifyOwnedClient: (owner: VoucherOwner) => Promise<boolean>;
}>): OwnedVoucherSource {
  const owned = async (owner: VoucherOwner) =>
    validOwner(owner) && await input.verifyOwnedClient(owner) === true;

  return {
    proveTenantCustomerOwner: owned,
    async getVoucherForOwner(owner, inventoryId) {
      if (!await owned(owner) ||
          !Number.isSafeInteger(inventoryId) || inventoryId <= 0) return null;
      const r = await input.pool.request()
        .input("tenantId", sql.UniqueIdentifier, owner.tenantId)
        .input("clientId", sql.Int, owner.customerId)
        .input("inventoryId", sql.Int, inventoryId)
        .query<{
          InventoryID: number; ClientID: number;
          VoucherCode: string; Status: string; ExpiresAt: Date | null;
        }>(`
          SELECT TOP (2)
            ci.InventoryID, ci.ClientID, ci.VoucherCode,
            ci.Status, ci.ExpiresAt
          FROM dbo.TblClientInventory ci
          INNER JOIN dbo.TblClient c ON c.ClientID=ci.ClientID
          WHERE ci.InventoryID=@inventoryId
            AND ci.ClientID=@clientId AND c.TenantId=@tenantId
            AND ci.Status=N'ACTIVE'
            AND (ci.ExpiresAt IS NULL OR ci.ExpiresAt>GETDATE())
        `);
      if (r.recordset.length !== 1) return null;
      const row = r.recordset[0];
      if (row.ClientID !== owner.customerId ||
          row.InventoryID !== inventoryId ||
          row.Status !== "ACTIVE") return null;
      return {
        ownerCustomerId: row.ClientID,
        inventoryId: row.InventoryID,
        voucherCode: row.VoucherCode,
        status: row.Status,
        expiresAt: row.ExpiresAt,
      } as OwnedVoucherRecord;
    },
  };
}

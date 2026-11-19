/**
 * CUT CLUB 2.0 — read-only SQL projection for verified member snapshots.
 *
 * This adapter does NOT resolve tenant ownership or authenticate users.
 * It only accepts an injected independently verified owner check; without
 * one it fails closed. No HTTP route or ConnectionPool is constructed here.
 * Every query reuses ONLY customer ID derived from the durable session and
 * repeats the customer key at SQL level. No phone/mobile/PII lookup API.
 */
import sql from "mssql";
import type { ClubMemberKey, LedgerDbRow, MemberDbRow, MemberReadStore, VoucherDbRow } from "./memberReadCore";

const valid = (key: ClubMemberKey) => typeof key.customerId === "number" &&
  Number.isSafeInteger(key.customerId) && key.customerId > 0 &&
  typeof key.tenantId === "string" && /^[a-f\d-]{36}$/i.test(key.tenantId);

export function createSqlMemberReadSource(input: Readonly<{
  /** Explicitly supplied pool. Never infer public tenant/customer from body or query. */
  pool: sql.ConnectionPool;
  /** Trusted authoritative tenant->client mapper; NOT a browser-supplied boolean. */
  proveTenantCustomerOwnership: (key: ClubMemberKey) => Promise<boolean>;
}>): MemberReadStore {
  const proven = async (key: ClubMemberKey) => valid(key) &&
    (await input.proveTenantCustomerOwnership(key)) === true;

  return {
    ownsCustomer: proven,
    async memberRow(key) {
      if (!await proven(key)) return [];
      const result = await input.pool.request()
        .input("clientId", sql.Int, key.customerId)
        .query<MemberDbRow>(`
          SELECT c.ClientID, c.Name AS ClientName, cl.ClientLoyaltyID,
                 cl.PointsBalance, cl.LifetimeEarnedPoints, cl.TotalVisits,
                 lt.TierCode, lt.TierNameAr, cl.LastVisitDate
          FROM dbo.TblClient AS c
          LEFT JOIN dbo.TblClientLoyalty AS cl ON cl.ClientID = c.ClientID
          LEFT JOIN dbo.TblLoyaltyTier AS lt ON lt.TierID = cl.TierID
          WHERE c.ClientID = @clientId
        `);
      return result.recordset;
    },
    async ledgerRows(key) {
      if (!await proven(key)) return [];
      const result = await input.pool.request()
        .input("clientId", sql.Int, key.customerId)
        .query<LedgerDbRow>(`
          SELECT TOP (20) l.LedgerID, l.MovementType, l.PointsDelta, l.CreatedAt
          FROM dbo.TblLoyaltyPointLedger AS l
          JOIN dbo.TblClientLoyalty AS cl ON cl.ClientLoyaltyID = l.ClientLoyaltyID
          WHERE cl.ClientID = @clientId
          ORDER BY l.CreatedAt DESC, l.LedgerID DESC
        `);
      return result.recordset;
    },
    async voucherRows(key) {
      if (!await proven(key)) return [];
      const result = await input.pool.request()
        .input("clientId", sql.Int, key.customerId)
        .query<VoucherDbRow>(`
          SELECT TOP (25) ci.InventoryID, ci.Status, si.NameAr, ci.ExpiresAt
          FROM dbo.TblClientInventory AS ci
          JOIN dbo.TblLoyaltyStoreItem AS si ON si.ItemID = ci.ItemID
          WHERE ci.ClientID = @clientId
          ORDER BY ci.PurchasedAt DESC, ci.InventoryID DESC
        `);
      return result.recordset;
    },
  };
}

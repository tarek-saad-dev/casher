/**
 * CUT CLUB 2.0 — tenant/branch/invoice scoped POS voucher verification and
 * exactly-once consumption. New cashier path only, never public/clientId auth.
 *
 * FREE_SERVICE is the only supported redemption type in this candidate:
 * the cashier must save a real sales invoice with the matching service line
 * at zero final price BEFORE the voucher can be marked used.
 *
 * No authorization is inferred from code knowledge; routes must authenticate
 * an operable staff member with an authoritative tenant and active branch.
 * This has NOT been exercised on production SQL.
 */
import sql from "mssql";

export type CashierScope = Readonly<{
  tenantId: string;
  activeBranchId: number;
  legacySalonId: number;
  staffUserId: number;
}>;
export type CashierVoucher = Readonly<{
  inventoryId: number;
  customerName: string;
  itemName: string;
  itemType: string;
  serviceId: number | null;
  status: "ACTIVE" | "USED" | "EXPIRED" | "CANCELLED";
  expiresAt: string | null;
  usable: boolean;
  consumptionSupported: boolean;
}>;
export type CashierUseResult = Readonly<{
  ok: true;
  replayed: boolean;
  inventoryId: number;
  invoiceId: number;
  status: "USED";
}> | Readonly<{ ok: false; reason: "unavailable" }>;

const validId = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n > 0;
const validUuid = (x: unknown): x is string =>
  typeof x === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const validCode = (x: unknown): x is string =>
  typeof x === "string" && /^[A-Z0-9-]{6,100}$/.test(x);
export const validCashierScope = (x: CashierScope): boolean =>
  validUuid(x.tenantId) && validId(x.activeBranchId) && validId(x.legacySalonId) && validId(x.staffUserId);
export const CASHIER_REDEEM_FLAG = "CUT_CLUB_CASHIER_V2_REDEEM_ENABLED";

export function allowCashierConsume(input: Readonly<{
  featureEnabled: boolean;
  scope: CashierScope;
  code: unknown;
  invoiceId: unknown;
}>): boolean {
  return input.featureEnabled === true &&
    validCashierScope(input.scope) && validCode(input.code) &&
    validId(input.invoiceId);
}

type VoucherRow = {
  InventoryID: number; ClientID: number; ClientName: string | null;
  NameAr: string; Status: string; ExpiresAt: Date | null;
  ItemType: string; ServiceID: number | null; UsedInvID: number | null;
  Quantity: number;
};
const acceptedStatus = new Set(["ACTIVE", "USED", "EXPIRED", "CANCELLED"]);

const lookupQuery = `
SELECT TOP (2)
  ci.InventoryID, ci.ClientID, c.Name AS ClientName,
  si.NameAr, ci.Status, ci.ExpiresAt,
  si.ItemType, si.ServiceID, ci.UsedInvID, ci.Quantity
FROM dbo.TblClientInventory ci
JOIN dbo.TblClient c ON c.ClientID=ci.ClientID
JOIN dbo.TblLoyaltyStoreItem si ON si.ItemID=ci.ItemID
WHERE ci.VoucherCode=@code AND c.TenantId=@tenantId
  AND (si.SalonID IS NULL OR si.SalonID=@legacySalonId)
`;
const lookupForUpdate = lookupQuery.replace(
  "dbo.TblClientInventory ci",
  "dbo.TblClientInventory ci WITH (UPDLOCK, HOLDLOCK)"
);

function rowToSafeVoucher(row: VoucherRow): CashierVoucher | null {
  if (!validId(row.InventoryID) || typeof row.ClientName !== "string" ||
      typeof row.NameAr !== "string" || !acceptedStatus.has(row.Status)) return null;
  const expiresAt = row.ExpiresAt instanceof Date && !Number.isNaN(row.ExpiresAt.getTime())
    ? row.ExpiresAt.toISOString() : null;
  const expiredNow = row.ExpiresAt instanceof Date && row.ExpiresAt.getTime() <= Date.now();
  return {
    inventoryId: row.InventoryID,
    customerName: row.ClientName,
    itemName: row.NameAr,
    itemType: row.ItemType,
    serviceId: row.ServiceID,
    status: row.Status as CashierVoucher["status"],
    expiresAt,
    usable: row.Status === "ACTIVE" && !expiredNow && row.Quantity === 1,
    consumptionSupported: row.ItemType === "FREE_SERVICE" && validId(row.ServiceID) && row.Quantity === 1,
  };
}

/** Staff-only read; never accept tenant/branch from the browser. */
export async function inspectCashierVoucher(input: Readonly<{
  pool: sql.ConnectionPool;
  scope: CashierScope;
  code: string;
}>): Promise<CashierVoucher | null> {
  if (!validCashierScope(input.scope) || !validCode(input.code)) return null;
  try {
    const found = await input.pool.request()
      .input("code", sql.NVarChar(100), input.code)
      .input("tenantId", sql.UniqueIdentifier, input.scope.tenantId)
      .input("legacySalonId", sql.Int, input.scope.legacySalonId)
      .query<VoucherRow>(lookupQuery);
    return found.recordset.length === 1 ? rowToSafeVoucher(found.recordset[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Confirmed invoice FREE_SERVICE benefit only. All checks and the conditional
 * voucher UPDATE, followed by a usage log, run in ONE SERIALIZABLE transaction.
 * A retry with the same invoice is idempotent and does not insert another log.
 * No invoice? No item effect proof? No write.
 */
export async function consumeCashierVoucher(input: Readonly<{
  pool: sql.ConnectionPool;
  scope: CashierScope;
  code: string;
  invoiceId: number;
  featureEnabled: boolean;
}>): Promise<CashierUseResult> {
  const unavailable = (): CashierUseResult => ({ ok: false, reason: "unavailable" });
  if (!allowCashierConsume(input)) return unavailable();
  const tx = new sql.Transaction(input.pool);
  try {
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const lookup = await new sql.Request(tx)
      .input("code", sql.NVarChar(100), input.code)
      .input("tenantId", sql.UniqueIdentifier, input.scope.tenantId)
      .input("legacySalonId", sql.Int, input.scope.legacySalonId)
      .query<VoucherRow>(lookupForUpdate);
    if (lookup.recordset.length !== 1) throw Error("CUT_CLUB_VOUCHER_NOT_OWNED");
    const v = lookup.recordset[0];
    if (!validId(v.InventoryID) || !validId(v.ClientID) ||
        v.ItemType !== "FREE_SERVICE" || !validId(v.ServiceID) ||
        v.Quantity !== 1) throw Error("CUT_CLUB_UNSUPPORTED");

    // Voucher and invoice must be for the SAME customer and active branch.
    const invoice = await new sql.Request(tx)
      .input("invoiceId", sql.Int, input.invoiceId)
      .input("branchId", sql.Int, input.scope.activeBranchId)
      .input("clientId", sql.Int, v.ClientID)
      .query(`
        SELECT TOP (2) h.invID
        FROM dbo.TblinvServHead h WITH (UPDLOCK, HOLDLOCK)
        WHERE h.invID=@invoiceId AND h.invType=N'مبيعات'
          AND h.BranchID=@branchId AND h.ClientID=@clientId
      `);
    if (invoice.recordset.length !== 1) throw Error("CUT_CLUB_INVOICE_NOT_OWNED");

    if (v.Status === "USED") {
      if (v.UsedInvID !== input.invoiceId) throw Error("CUT_CLUB_ALREADY_USED");
      await tx.commit();
      return { ok: true, replayed: true, inventoryId: v.InventoryID, invoiceId: input.invoiceId, status: "USED" };
    }
    if (v.Status !== "ACTIVE" || (v.ExpiresAt && v.ExpiresAt.getTime() <= Date.now()))
      throw Error("CUT_CLUB_NOT_ACTIVE");

    // Financial evidence: item was actually included in the saved invoice at
    // zero final service price. Other benefit types need their own settled,
    // verifiable evidence model and are intentionally not accepted here.
    const benefit = await new sql.Request(tx)
      .input("invoiceId", sql.Int, input.invoiceId)
      .input("serviceId", sql.Int, v.ServiceID)
      .query(`
        SELECT TOP (1) d.ProID
        FROM dbo.TblinvServDetail d WITH (HOLDLOCK)
        WHERE d.invID=@invoiceId AND d.invType=N'مبيعات'
          AND d.ProID=@serviceId AND d.Qty>0 AND d.SPriceAfterDis=0
      `);
    if (benefit.recordset.length !== 1) throw Error("CUT_CLUB_BENEFIT_NOT_APPLIED");

    const used = await new sql.Request(tx)
      .input("inventoryId", sql.Int, v.InventoryID)
      .input("clientId", sql.Int, v.ClientID)
      .input("invoiceId", sql.Int, input.invoiceId)
      .query(`
        UPDATE dbo.TblClientInventory
        SET Status=N'USED', UsedAt=GETDATE(), UsedInvID=@invoiceId
        WHERE InventoryID=@inventoryId AND ClientID=@clientId
          AND Status=N'ACTIVE' AND Quantity=1
          AND (ExpiresAt IS NULL OR ExpiresAt>GETDATE());
      `);
    if (used.rowsAffected?.[0] !== 1) throw Error("CUT_CLUB_CONCURRENT_REDEEM");

    const logged = await new sql.Request(tx)
      .input("inventoryId", sql.Int, v.InventoryID)
      .input("clientId", sql.Int, v.ClientID)
      .input("invoiceId", sql.Int, input.invoiceId)
      .query(`
        INSERT INTO dbo.TblInventoryUsageLog
          (InventoryID, ClientID, InvID, BookingID, ActionType, UsedAt, Notes)
        VALUES (@inventoryId, @clientId, @invoiceId, NULL, N'USED',
                GETDATE(), N'CUT CLUB V2 verified cashier invoice redemption');
      `);
    if (logged.rowsAffected?.[0] !== 1) throw Error("CUT_CLUB_LOG_FAILED");
    await tx.commit();
    return { ok: true, replayed: false, inventoryId: v.InventoryID,
      invoiceId: input.invoiceId, status: "USED" };
  } catch {
    try { await tx.rollback(); } catch { /* original failure wins */ }
    return unavailable();
  }
}

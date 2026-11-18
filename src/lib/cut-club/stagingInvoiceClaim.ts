/**
 * CUT CLUB 2.0: STAGING-ONLY atomic POS invoice + voucher claim.
 *
 * Runs inside the SAME SQL Transaction as TblinvServHead/Detail/Payment.
 * No background jobs, post-commit compensation, public auth or customer ID
 * from voucher code. Never executes writes on last132 production.
 *
 * Trial/legacy 74 customer vouchers on last132 are not migrated or touched.
 */
import "server-only";
import sql from "mssql";
import { isCutClubCashierBranchApproved } from "./cashierProductionBranchPolicy";
import { verifyApprovedCutClubService } from "./reviewedServiceEntitlements";

export const STAGING_VOUCHER_INVOICE_FLAG =
  "CUT_CLUB_STAGING_CLAIM_WRITE_ENABLED" as const;

export const approvedProductionRewardToService = Object.freeze({
  15: 39, 16: 22, 17: 11, 18: 9,
} as const);

export const CUT_CLUB_CASHER_BOOT_TENANT =
  "413d433e-f36b-1410-8820-009ec495c7e1";

export function stagingServiceApprovalJson(): string {
  return JSON.stringify(Object.fromEntries(
    Object.entries(approvedProductionRewardToService).map(([item, service]) =>
      [CUT_CLUB_CASHER_BOOT_TENANT + ":" + item, service]),
  ));
}

/** Code is supplied by authorized POS cashier at sale creation, not auth. */
const voucherFormat = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Z0-9-]{6,100}$/.test(v);
const positive = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(v);

/** Always interrogate the connection actually owning the transaction. */
async function connectionContext(tx: sql.Transaction): Promise<{
  isStaging: boolean; hasClaimTable: boolean;
}> {
  const r = await new sql.Request(tx).query<{
    DbName: string; LoginName: string; HasClaimTable: number;
  }>(`
    SELECT DB_NAME() AS DbName, SUSER_SNAME() AS LoginName,
      CASE WHEN OBJECT_ID(N'dbo.CutClubVoucherInvoiceClaim', N'U') IS NOT NULL
        THEN 1 ELSE 0 END AS HasClaimTable
  `);
  if (r.recordset.length !== 1) throw Error("CUT_CLUB_DB_CONTEXT_UNVERIFIED");
  const c = r.recordset[0];
  return {
    isStaging: c.DbName === "last132_agent" && c.LoginName === "drvo_agent",
    hasClaimTable: c.HasClaimTable === 1,
  };
}
async function requireStagingWrites(tx: sql.Transaction): Promise<void> {
  if (process.env[STAGING_VOUCHER_INVOICE_FLAG] !== "true")
    throw Error("CUT_CLUB_STAGING_WRITE_DISABLED");
  const ctx = await connectionContext(tx);
  if (!ctx.isStaging || !ctx.hasClaimTable)
    throw Error("CUT_CLUB_STAGING_CONNECTION_OR_CLAIM_SCHEMA_UNVERIFIED");
}

type ClaimedVoucher = {
  InventoryID: number; ItemID: number; ClientID: number;
  Quantity: number; Status: string; UsedInvID: number | null;
  ExpiresAt: Date | null; ItemType: string; ServiceID: number | null;
  SalonID: number | null;
};

/** Inside the sale transaction, before commit. Throws => whole invoice rolls back. */
export async function stageVoucherOnNewSale(tx: sql.Transaction, input: Readonly<{
  trustedTenantId: string;
  trustedBranchId: number;
  trustedClientId: number | null;
  invoiceId: number;
  voucherCode?: unknown;
}>): Promise<boolean> {
  if (input.voucherCode === undefined || input.voucherCode === null ||
      input.voucherCode === "") return false; // ordinary POS sale unchanged
  if (!uuid(input.trustedTenantId) || !positive(input.trustedBranchId) ||
      !positive(input.trustedClientId) || !positive(input.invoiceId) ||
      !voucherFormat(input.voucherCode)) throw Error("CUT_CLUB_CLAIM_BAD_INPUT");

  // Never allow active PH1GTEST (branch 2), demo tenants or user-provided scope.
  if (!isCutClubCashierBranchApproved({
    trustedTenantId: input.trustedTenantId,
    trustedBranchId: input.trustedBranchId,
    allowlistJson: process.env.CUT_CLUB_STAGING_APPROVED_BRANCHES_JSON,
  })) throw Error("CUT_CLUB_STAGING_BRANCH_NOT_APPROVED");
  await requireStagingWrites(tx);

  const found = await new sql.Request(tx)
    .input("code", sql.NVarChar(100), input.voucherCode)
    .input("tenantId", sql.UniqueIdentifier, input.trustedTenantId)
    .input("clientId", sql.Int, input.trustedClientId)
    .query<ClaimedVoucher>(`
      SELECT TOP (2)
        ci.InventoryID, ci.ItemID, ci.ClientID, ci.Quantity,
        ci.Status, ci.UsedInvID, ci.ExpiresAt,
        si.ItemType, si.ServiceID, si.SalonID
      FROM dbo.TblClientInventory AS ci WITH (UPDLOCK, HOLDLOCK)
      INNER JOIN dbo.TblClient AS c ON c.ClientID=ci.ClientID
      INNER JOIN dbo.TblLoyaltyStoreItem AS si ON si.ItemID=ci.ItemID
      WHERE ci.VoucherCode=@code AND ci.ClientID=@clientId
        AND c.TenantId=@tenantId AND si.IsActive=1
        AND si.SalonID IS NULL
    `);
  if (found.recordset.length !== 1) throw Error("CUT_CLUB_CLAIM_NOT_OWNED");
  const voucher = found.recordset[0];
  if (!positive(voucher.InventoryID) || !positive(voucher.ItemID) ||
      voucher.ClientID !== input.trustedClientId || voucher.Quantity !== 1 ||
      voucher.Status !== "ACTIVE" || voucher.UsedInvID !== null ||
      voucher.ItemType !== "FREE_SERVICE" ||
      (voucher.ExpiresAt !== null && new Date(voucher.ExpiresAt).getTime() <= Date.now()))
    throw Error("CUT_CLUB_CLAIM_INELIGIBLE");

  const serviceId = await verifyApprovedCutClubService({
    trustedTenantId: input.trustedTenantId,
    rewardItemId: voucher.ItemID,
    dbServiceId: voucher.ServiceID,
    // Owner approved exact mapping; staged code pins this to trusted
    // CASHER_BOOT UUID. No browser-supplied approval. No VPS env override.
    approvalJson: stagingServiceApprovalJson(),
    isActiveTenantService: async (tenantId, id) => {
      const sr = await new sql.Request(tx)
        .input("tenantId", sql.UniqueIdentifier, tenantId)
        .input("id", sql.Int, id)
        .query<{ ProID: number }>(`
          SELECT TOP (2) ProID FROM dbo.TblPro
          WHERE TenantId=@tenantId AND ProID=@id AND isDeleted=0
        `);
      return sr.recordset.length === 1 && sr.recordset[0].ProID === id;
    },
  });
  if (!positive(serviceId)) throw Error("CUT_CLUB_CLAIM_SERVICE_NOT_APPROVED");

  const invoice = await new sql.Request(tx)
    .input("invoiceId", sql.Int, input.invoiceId)
    .input("branchId", sql.Int, input.trustedBranchId)
    .input("clientId", sql.Int, input.trustedClientId)
    .query<{ invID: number }>(`
      SELECT TOP (2) invID FROM dbo.TblinvServHead WITH (UPDLOCK, HOLDLOCK)
      WHERE invID=@invoiceId AND invType=N'مبيعات'
        AND ClientID=@clientId AND BranchID=@branchId
    `);
  if (invoice.recordset.length !== 1)
    throw Error("CUT_CLUB_CLAIM_SALE_NOT_OWNED");

  const lines = await new sql.Request(tx)
    .input("invoiceId", sql.Int, input.invoiceId)
    .input("serviceId", sql.Int, serviceId)
    .query<{ ProID: number; SPrice: number; SPriceAfterDis: number; Qty: number }>(`
      SELECT TOP (3) ProID, SPrice, SPriceAfterDis, Qty
      FROM dbo.TblinvServDetail WITH (UPDLOCK, HOLDLOCK)
      WHERE invID=@invoiceId AND invType=N'مبيعات' AND ProID=@serviceId
    `);
  // One explicit catalog-priced service is made free on THIS invoice,
  // not an unrelated manager comp or a silently doubled service line.
  if (lines.recordset.length !== 1 ||
      Number(lines.recordset[0].Qty) !== 1 ||
      !(Number(lines.recordset[0].SPrice) > 0) ||
      Number(lines.recordset[0].SPriceAfterDis) !== 0)
    throw Error("CUT_CLUB_CLAIM_INVOICE_BENEFIT_MISMATCH");

  const claim = await new sql.Request(tx)
    .input("tenantId", sql.UniqueIdentifier, input.trustedTenantId)
    .input("inventoryId", sql.Int, voucher.InventoryID)
    .input("clientId", sql.Int, input.trustedClientId)
    .input("branchId", sql.Int, input.trustedBranchId)
    .input("invoiceId", sql.Int, input.invoiceId)
    .input("serviceId", sql.Int, serviceId)
    .query<{ ClaimID: number }>(`
      INSERT INTO dbo.CutClubVoucherInvoiceClaim
        (TenantId, InventoryID, ClientID, BranchID, InvID, ServiceID, Status)
      OUTPUT INSERTED.ClaimID
      VALUES (@tenantId, @inventoryId, @clientId, @branchId,
              @invoiceId, @serviceId, N'APPLIED')
    `);
  if (claim.recordset.length !== 1)
    throw Error("CUT_CLUB_CLAIM_INSERT_FAILED");

  const consumed = await new sql.Request(tx)
    .input("inventoryId", sql.Int, voucher.InventoryID)
    .input("clientId", sql.Int, input.trustedClientId)
    .input("invoiceId", sql.Int, input.invoiceId)
    .query(`
      UPDATE dbo.TblClientInventory
      SET Status=N'USED', UsedAt=GETDATE(), UsedInvID=@invoiceId
      WHERE InventoryID=@inventoryId AND ClientID=@clientId
        AND Status=N'ACTIVE' AND Quantity=1
        AND UsedInvID IS NULL AND (ExpiresAt IS NULL OR ExpiresAt>GETDATE())
    `);
  if (consumed.rowsAffected?.[0] !== 1)
    throw Error("CUT_CLUB_CLAIM_CONCURRENT_REDEMPTION");

  const log = await new sql.Request(tx)
    .input("inventoryId", sql.Int, voucher.InventoryID)
    .input("clientId", sql.Int, input.trustedClientId)
    .input("invoiceId", sql.Int, input.invoiceId)
    .query(`
      INSERT INTO dbo.TblInventoryUsageLog
        (InventoryID, ClientID, InvID, BookingID, ActionType, UsedAt, Notes)
      VALUES (@inventoryId, @clientId, @invoiceId, NULL, N'USED',
              GETDATE(), N'CUT CLUB staging invoice-atomic claim')
    `);
  if (log.rowsAffected?.[0] !== 1)
    throw Error("CUT_CLUB_CLAIM_USAGE_LOG_FAILED");
  return true;
}

/** Called from audited PUT transaction; no silent edit of a claimed invoice. */
export async function denyEditOfStagingClaimedSale(
  tx: sql.Transaction, trustedInvoiceId: number,
): Promise<void> {
  if (!positive(trustedInvoiceId)) throw Error("CUT_CLUB_INVALID_INVOICE");
  const ctx = await connectionContext(tx);
  // Production last132 has no new claim table: no financial mutation here.
  if (!ctx.hasClaimTable) return;
  if (!ctx.isStaging) throw Error("CUT_CLUB_UNREVIEWED_CLAIM_SCHEMA");
  const claim = await new sql.Request(tx)
    .input("invoiceId", sql.Int, trustedInvoiceId)
    .query<{ ClaimID: number }>(`
      SELECT TOP (2) ClaimID FROM dbo.CutClubVoucherInvoiceClaim WITH (UPDLOCK, HOLDLOCK)
      WHERE InvID=@invoiceId AND Status=N'APPLIED'
    `);
  if (claim.recordset.length > 0)
    throw Error("CUT_CLUB_CLAIMED_INVOICE_REQUIRES_CANCEL_REISSUE");
}

/**
 * BEFORE deleting paid invoice, in the SAME audited SQL transaction.
 * Reversal preserves historical claim row, restores voucher availability,
 * and never creates a fake legacy invoice. If the transaction fails later,
 * the reversal and voucher restoration both roll back.
 */
export async function reverseStagingClaimBeforeSaleDeletion(tx: sql.Transaction, input: Readonly<{
  trustedTenantId: string;
  trustedBranchId: number;
  invoiceId: number;
}>): Promise<boolean> {
  if (!uuid(input.trustedTenantId) || !positive(input.trustedBranchId) ||
      !positive(input.invoiceId)) throw Error("CUT_CLUB_REVERSE_INVALID_SCOPE");
  const ctx = await connectionContext(tx);
  if (!ctx.hasClaimTable) return false;
  if (!ctx.isStaging) throw Error("CUT_CLUB_UNREVIEWED_CLAIM_SCHEMA");
  const claims = await new sql.Request(tx)
    .input("tenantId", sql.UniqueIdentifier, input.trustedTenantId)
    .input("invoiceId", sql.Int, input.invoiceId)
    .input("branchId", sql.Int, input.trustedBranchId)
    .query<{ ClaimID: number; InventoryID: number; ClientID: number }>(`
      SELECT TOP (2) ClaimID, InventoryID, ClientID
      FROM dbo.CutClubVoucherInvoiceClaim WITH (UPDLOCK, HOLDLOCK)
      WHERE TenantId=@tenantId AND BranchID=@branchId AND InvID=@invoiceId
        AND Status=N'APPLIED'
    `);
  if (claims.recordset.length === 0) {
    // Never ignore a foreign-tenant claim on the same invoice ID.
    const anyClaim = await new sql.Request(tx)
      .input("invoiceId", sql.Int, input.invoiceId)
      .query<{ ClaimID: number }>(`
        SELECT TOP (1) ClaimID FROM dbo.CutClubVoucherInvoiceClaim
        WHERE InvID=@invoiceId AND Status=N'APPLIED'
      `);
    if (anyClaim.recordset.length) throw Error("CUT_CLUB_REVERSE_TENANT_MISMATCH");
    return false;
  }
  if (claims.recordset.length !== 1)
    throw Error("CUT_CLUB_REVERSE_AMBIGUOUS");
  if (process.env[STAGING_VOUCHER_INVOICE_FLAG] !== "true")
    throw Error("CUT_CLUB_REVERSAL_WRITE_DISABLED");

  const claim = claims.recordset[0];
  const restored = await new sql.Request(tx)
    .input("inventoryId", sql.Int, claim.InventoryID)
    .input("clientId", sql.Int, claim.ClientID)
    .input("invoiceId", sql.Int, input.invoiceId)
    .query(`
      UPDATE dbo.TblClientInventory
      SET Status=N'ACTIVE', UsedAt=NULL, UsedInvID=NULL
      WHERE InventoryID=@inventoryId AND ClientID=@clientId
        AND Status=N'USED' AND UsedInvID=@invoiceId
    `);
  if (restored.rowsAffected?.[0] !== 1)
    throw Error("CUT_CLUB_REVERSE_VOUCHER_STATE_MISMATCH");

  const reversed = await new sql.Request(tx)
    .input("claimId", sql.BigInt, claim.ClaimID)
    .query(`
      UPDATE dbo.CutClubVoucherInvoiceClaim
      SET Status=N'REVERSED', ReversedAt=SYSUTCDATETIME()
      WHERE ClaimID=@claimId AND Status=N'APPLIED'
    `);
  if (reversed.rowsAffected?.[0] !== 1)
    throw Error("CUT_CLUB_REVERSE_CLAIM_CONCURRENT");
  // The old USED usage log stays as immutable historical evidence. The
  // REVERSED claim status gives the effective entitlement state.
  return true;
}

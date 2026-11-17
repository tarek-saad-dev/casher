/**
 * CUT CLUB cashier V2 — operator-requested Production DB METADATA preflight.
 *
 * Deliberately reads SQL Server sys schema metadata only, never SELECTs a
 * customer, loyalty, voucher, invoice or payment row and never writes SQL.
 * This is a diagnostics candidate, NOT proof of transaction correctness or
 * permission to enable any customer-facing endpoint.
 */
import "server-only";
import sql from "mssql";

export const CUT_CLUB_REQUIRED_COLUMNS = Object.freeze({
  TblClient: ["ClientID", "TenantId", "Name", "Mobile"],
  TblClientLoyalty: [
    "ClientLoyaltyID", "ClientID", "IsActive", "PointsBalance",
    "LifetimeEarnedPoints", "TotalVisits", "TierID", "LastVisitDate",
  ],
  TblLoyaltyTier: ["TierID", "TierCode", "TierNameAr", "SortOrder"],
  TblLoyaltyPointLedger: [
    "LedgerID", "ClientLoyaltyID", "MovementType", "PointsDelta", "CreatedAt",
  ],
  TblClientInventory: [
    "InventoryID", "ClientID", "ItemID", "VoucherCode",
    "Status", "ExpiresAt", "UsedAt", "UsedInvID",
  ],
  TblLoyaltyStoreItem: [
    "ItemID", "SalonID", "NameAr", "ItemType", "ServiceID",
  ],
  TblinvServHead: ["invID", "invType", "BranchID", "ClientID"],
  TblinvServDetail: ["invID", "invType", "ProID", "Qty", "SPriceAfterDis"],
  TblInventoryUsageLog: [
    "InventoryID", "ClientID", "InvID", "BookingID",
    "ActionType", "UsedAt", "Notes",
  ],
} as const);

export type CutClubReadinessCheck = Readonly<{
  table: keyof typeof CUT_CLUB_REQUIRED_COLUMNS;
  found: boolean;
  missingColumns: readonly string[];
}>;
export type CutClubCashierMetadataReport = Readonly<{
  inspectedMetadataOnly: true;
  databaseMatchesOperatorExpectation: true;
  schemaCompatible: boolean;
  checks: readonly CutClubReadinessCheck[];
  verifiedAccountLinkage: false;
  verifiedBranchSalonLinkage: false;
  verifiedFinancialSettlement: false;
  readyForClientRelease: false;
  readyForCashierRedemption: false;
}>;
type MetaRow = Readonly<{ TableName: string; ColumnName: string }>;
const allowed = new Set<string>(Object.keys(CUT_CLUB_REQUIRED_COLUMNS));

/** Pure, deterministic schema compatibility check. Never requires PII. */
export function evaluateCashierSchema(rows: readonly MetaRow[]): CutClubCashierMetadataReport {
  const present = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row || !allowed.has(row.TableName) || typeof row.ColumnName !== "string") continue;
    if (!present.has(row.TableName)) present.set(row.TableName, new Set());
    present.get(row.TableName)!.add(row.ColumnName.toLowerCase());
  }
  const checks = Object.entries(CUT_CLUB_REQUIRED_COLUMNS).map(([table, cols]) => {
    const owned = present.get(table);
    return Object.freeze({
      table: table as keyof typeof CUT_CLUB_REQUIRED_COLUMNS,
      found: owned !== undefined,
      missingColumns: Object.freeze(cols.filter(column => !owned?.has(column.toLowerCase()))),
    });
  });
  return Object.freeze({
    inspectedMetadataOnly: true as const,
    databaseMatchesOperatorExpectation: true as const,
    schemaCompatible: checks.every(c => c.found && c.missingColumns.length === 0),
    checks: Object.freeze(checks),
    // Never claim release readiness from metadata alone.
    verifiedAccountLinkage: false as const,
    verifiedBranchSalonLinkage: false as const,
    verifiedFinancialSettlement: false as const,
    readyForClientRelease: false as const,
    readyForCashierRedemption: false as const,
  });
}

/** Operator must explicitly set this to a validated real DB name. */
export function expectedProductionDbIsConfigured(name: unknown): name is string {
  return typeof name === "string" && name.length >= 3 &&
    name.length <= 128 && name !== "__OPERATOR_VERIFY_DATABASE_NAME__" &&
    /^[A-Za-z0-9_\-]+$/.test(name);
}

/**
 * @remarks This is NOT called in build/tests. Only an authenticated admin
 * can reach the flag-gated /api/admin/cut-club/readiness route. The
 * DATABASE check happens on the very same connection as metadata query.
 * SQL is parameterized; no dynamic object/table identifiers or user input.
 */
export async function readOperatorCashierMetadata(input: Readonly<{
  pool: sql.ConnectionPool;
  operatorExpectedDbName: string;
}>): Promise<CutClubCashierMetadataReport | null> {
  if (!expectedProductionDbIsConfigured(input.operatorExpectedDbName)) return null;
  try {
    const records = await input.pool.request()
      .input("expectedDb", sql.NVarChar(128), input.operatorExpectedDbName)
      .query<MetaRow>(`
        SET NOCOUNT ON;
        IF DB_NAME() <> @expectedDb
          THROW 51091, 'CUT CLUB production metadata DB mismatch', 1;
        SELECT t.name AS TableName, c.name AS ColumnName
        FROM sys.tables AS t
        INNER JOIN sys.schemas AS s ON s.schema_id=t.schema_id
        INNER JOIN sys.columns AS c ON c.object_id=t.object_id
        WHERE s.name=N'dbo'
          AND t.name IN (
            N'TblClient',N'TblClientLoyalty',N'TblLoyaltyTier',
            N'TblLoyaltyPointLedger',N'TblClientInventory',
            N'TblLoyaltyStoreItem',N'TblinvServHead',
            N'TblinvServDetail',N'TblInventoryUsageLog'
          );
      `);
    return evaluateCashierSchema(records.recordset);
  } catch {
    return null;
  }
}

/**
 * Phase 1O/1S — branch setup policy flags.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';

export type OpeningInventoryOption = 'ZERO_STOCK' | 'NEW_PURCHASE' | 'TRANSFER_FROM_GLEEM' | null;
export type OpeningCashDecision = 'ZERO' | 'AMOUNT' | null;

export type BranchSetupPolicy = {
  branchId: number;
  sharedPrinterApproved: boolean;
  sharedWhatsAppApproved: boolean;
  openingInventoryOption: OpeningInventoryOption;
  openingInventoryApprovedAt: string | null;
  openingInventoryApprovedByUserId: number | null;
  usersAccessReviewedAt: string | null;
  partnerSharesDraftReady: boolean;
  englishDisplayName: string | null;
  notes: string | null;
  updatedAt: string | null;
  openingCashDecision: OpeningCashDecision;
  openingCashAmount: number | null;
  openingCashEffectiveDate: string | null;
  openingCashReason: string | null;
  openingCashApprovedAt: string | null;
  openingCashApprovedByUserId: number | null;
  internalLiveEffectiveDate: string | null;
};

let ensured = false;

async function ensurePhase1sColumns(db: Awaited<ReturnType<typeof getPool>>): Promise<void> {
  const cols: Array<{ name: string; ddl: string }> = [
    { name: 'OpeningCashDecision', ddl: 'NVARCHAR(20) NULL' },
    { name: 'OpeningCashAmount', ddl: 'DECIMAL(18,2) NULL' },
    { name: 'OpeningCashEffectiveDate', ddl: 'DATE NULL' },
    { name: 'OpeningCashReason', ddl: 'NVARCHAR(500) NULL' },
    { name: 'OpeningCashApprovedAt', ddl: 'DATETIME2 NULL' },
    { name: 'OpeningCashApprovedByUserID', ddl: 'INT NULL' },
    { name: 'InternalLiveEffectiveDate', ddl: 'DATE NULL' },
  ];
  for (const c of cols) {
    await db.request().query(`
      IF COL_LENGTH(N'dbo.TblBranchSetupPolicy', N'${c.name}') IS NULL
        ALTER TABLE dbo.TblBranchSetupPolicy ADD ${c.name} ${c.ddl};
    `);
  }
}

export async function ensureBranchSetupPolicyTable(): Promise<void> {
  if (ensured) return;
  const db = await getPool();
  await db.request().query(`
    IF OBJECT_ID(N'dbo.TblBranchSetupPolicy', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.TblBranchSetupPolicy (
        BranchID INT NOT NULL CONSTRAINT PK_TblBranchSetupPolicy PRIMARY KEY,
        SharedPrinterApproved BIT NOT NULL CONSTRAINT DF_BSP_SharedPrinter DEFAULT (0),
        SharedWhatsAppApproved BIT NOT NULL CONSTRAINT DF_BSP_SharedWA DEFAULT (0),
        OpeningInventoryOption NVARCHAR(40) NULL,
        OpeningInventoryApprovedAt DATETIME2 NULL,
        OpeningInventoryApprovedByUserID INT NULL,
        UsersAccessReviewedAt DATETIME2 NULL,
        PartnerSharesDraftReady BIT NOT NULL CONSTRAINT DF_BSP_PartnerDraft DEFAULT (0),
        EnglishDisplayName NVARCHAR(100) NULL,
        Notes NVARCHAR(500) NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_BSP_Created DEFAULT (SYSUTCDATETIME()),
        UpdatedAt DATETIME2 NULL,
        OpeningCashDecision NVARCHAR(20) NULL,
        OpeningCashAmount DECIMAL(18,2) NULL,
        OpeningCashEffectiveDate DATE NULL,
        OpeningCashReason NVARCHAR(500) NULL,
        OpeningCashApprovedAt DATETIME2 NULL,
        OpeningCashApprovedByUserID INT NULL,
        InternalLiveEffectiveDate DATE NULL
      );
    END
  `);
  await ensurePhase1sColumns(db);
  ensured = true;
}

function mapRow(row: Record<string, unknown>): BranchSetupPolicy {
  const opt = row.OpeningInventoryOption == null ? null : String(row.OpeningInventoryOption);
  const opening: OpeningInventoryOption =
    opt === 'ZERO_STOCK' || opt === 'NEW_PURCHASE' || opt === 'TRANSFER_FROM_GLEEM'
      ? opt
      : null;
  const cashRaw = row.OpeningCashDecision == null ? null : String(row.OpeningCashDecision);
  const cash: OpeningCashDecision =
    cashRaw === 'ZERO' || cashRaw === 'AMOUNT' ? cashRaw : null;
  const toIso = (v: unknown): string | null => {
    if (v == null) return null;
    if (v instanceof Date) return v.toISOString();
    return String(v);
  };
  const toDateOnly = (v: unknown): string | null => {
    if (v == null) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).slice(0, 10);
  };
  return {
    branchId: Number(row.BranchID),
    sharedPrinterApproved: Boolean(row.SharedPrinterApproved),
    sharedWhatsAppApproved: Boolean(row.SharedWhatsAppApproved),
    openingInventoryOption: opening,
    openingInventoryApprovedAt: toIso(row.OpeningInventoryApprovedAt),
    openingInventoryApprovedByUserId:
      row.OpeningInventoryApprovedByUserID == null
        ? null
        : Number(row.OpeningInventoryApprovedByUserID),
    usersAccessReviewedAt: toIso(row.UsersAccessReviewedAt),
    partnerSharesDraftReady: Boolean(row.PartnerSharesDraftReady),
    englishDisplayName:
      row.EnglishDisplayName == null ? null : String(row.EnglishDisplayName),
    notes: row.Notes == null ? null : String(row.Notes),
    updatedAt: toIso(row.UpdatedAt),
    openingCashDecision: cash,
    openingCashAmount:
      row.OpeningCashAmount == null ? null : Number(row.OpeningCashAmount),
    openingCashEffectiveDate: toDateOnly(row.OpeningCashEffectiveDate),
    openingCashReason:
      row.OpeningCashReason == null ? null : String(row.OpeningCashReason),
    openingCashApprovedAt: toIso(row.OpeningCashApprovedAt),
    openingCashApprovedByUserId:
      row.OpeningCashApprovedByUserID == null
        ? null
        : Number(row.OpeningCashApprovedByUserID),
    internalLiveEffectiveDate: toDateOnly(row.InternalLiveEffectiveDate),
  };
}

export async function getBranchSetupPolicy(
  branchId: number,
): Promise<BranchSetupPolicy | null> {
  await ensureBranchSetupPolicyTable();
  const db = await getPool();
  const result = await db
    .request()
    .input('branchId', sql.Int, branchId)
    .query(`SELECT * FROM dbo.TblBranchSetupPolicy WHERE BranchID = @branchId`);
  if (!result.recordset[0]) return null;
  return mapRow(result.recordset[0] as Record<string, unknown>);
}

export async function upsertBranchSetupPolicy(
  branchId: number,
  patch: Partial<{
    sharedPrinterApproved: boolean;
    sharedWhatsAppApproved: boolean;
    openingInventoryOption: OpeningInventoryOption;
    openingInventoryApprovedByUserId: number | null;
    markOpeningInventoryApprovedNow: boolean;
    usersAccessReviewedNow: boolean;
    partnerSharesDraftReady: boolean;
    englishDisplayName: string | null;
    notes: string | null;
    openingCashDecision: OpeningCashDecision;
    openingCashAmount: number | null;
    openingCashEffectiveDate: string | null;
    openingCashReason: string | null;
    openingCashApprovedByUserId: number | null;
    markOpeningCashApprovedNow: boolean;
    internalLiveEffectiveDate: string | null;
  }>,
): Promise<BranchSetupPolicy> {
  await ensureBranchSetupPolicyTable();
  const db = await getPool();
  await db
    .request()
    .input('branchId', sql.Int, branchId)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.TblBranchSetupPolicy WHERE BranchID = @branchId)
        INSERT INTO dbo.TblBranchSetupPolicy (BranchID) VALUES (@branchId)
    `);

  await db
    .request()
    .input('branchId', sql.Int, branchId)
    .input(
      'sharedPrinter',
      sql.Bit,
      patch.sharedPrinterApproved == null ? null : patch.sharedPrinterApproved ? 1 : 0,
    )
    .input(
      'sharedWa',
      sql.Bit,
      patch.sharedWhatsAppApproved == null ? null : patch.sharedWhatsAppApproved ? 1 : 0,
    )
    .input(
      'openOpt',
      sql.NVarChar(40),
      patch.openingInventoryOption === undefined ? null : patch.openingInventoryOption,
    )
    .input('setOpenOpt', sql.Bit, patch.openingInventoryOption !== undefined ? 1 : 0)
    .input(
      'openBy',
      sql.Int,
      patch.openingInventoryApprovedByUserId === undefined
        ? null
        : patch.openingInventoryApprovedByUserId,
    )
    .input('markOpenNow', sql.Bit, patch.markOpeningInventoryApprovedNow ? 1 : 0)
    .input('markUsersNow', sql.Bit, patch.usersAccessReviewedNow ? 1 : 0)
    .input(
      'partnerDraft',
      sql.Bit,
      patch.partnerSharesDraftReady == null
        ? null
        : patch.partnerSharesDraftReady
          ? 1
          : 0,
    )
    .input(
      'enName',
      sql.NVarChar(100),
      patch.englishDisplayName === undefined ? null : patch.englishDisplayName,
    )
    .input('setEnName', sql.Bit, patch.englishDisplayName !== undefined ? 1 : 0)
    .input('notes', sql.NVarChar(500), patch.notes === undefined ? null : patch.notes)
    .input('setNotes', sql.Bit, patch.notes !== undefined ? 1 : 0)
    .input(
      'cashDec',
      sql.NVarChar(20),
      patch.openingCashDecision === undefined ? null : patch.openingCashDecision,
    )
    .input('setCashDec', sql.Bit, patch.openingCashDecision !== undefined ? 1 : 0)
    .input(
      'cashAmt',
      sql.Decimal(18, 2),
      patch.openingCashAmount === undefined ? null : patch.openingCashAmount,
    )
    .input('setCashAmt', sql.Bit, patch.openingCashAmount !== undefined ? 1 : 0)
    .input(
      'cashDate',
      sql.Date,
      patch.openingCashEffectiveDate === undefined ? null : patch.openingCashEffectiveDate,
    )
    .input('setCashDate', sql.Bit, patch.openingCashEffectiveDate !== undefined ? 1 : 0)
    .input(
      'cashReason',
      sql.NVarChar(500),
      patch.openingCashReason === undefined ? null : patch.openingCashReason,
    )
    .input('setCashReason', sql.Bit, patch.openingCashReason !== undefined ? 1 : 0)
    .input(
      'cashBy',
      sql.Int,
      patch.openingCashApprovedByUserId === undefined
        ? null
        : patch.openingCashApprovedByUserId,
    )
    .input('markCashNow', sql.Bit, patch.markOpeningCashApprovedNow ? 1 : 0)
    .input(
      'liveDate',
      sql.Date,
      patch.internalLiveEffectiveDate === undefined ? null : patch.internalLiveEffectiveDate,
    )
    .input('setLiveDate', sql.Bit, patch.internalLiveEffectiveDate !== undefined ? 1 : 0)
    .query(`
      UPDATE dbo.TblBranchSetupPolicy
      SET
        SharedPrinterApproved = COALESCE(@sharedPrinter, SharedPrinterApproved),
        SharedWhatsAppApproved = COALESCE(@sharedWa, SharedWhatsAppApproved),
        OpeningInventoryOption = CASE WHEN @setOpenOpt = 1 THEN @openOpt ELSE OpeningInventoryOption END,
        OpeningInventoryApprovedByUserID = CASE
          WHEN @markOpenNow = 1 THEN @openBy
          ELSE OpeningInventoryApprovedByUserID
        END,
        OpeningInventoryApprovedAt = CASE
          WHEN @markOpenNow = 1 THEN SYSUTCDATETIME()
          ELSE OpeningInventoryApprovedAt
        END,
        UsersAccessReviewedAt = CASE
          WHEN @markUsersNow = 1 THEN SYSUTCDATETIME()
          ELSE UsersAccessReviewedAt
        END,
        PartnerSharesDraftReady = COALESCE(@partnerDraft, PartnerSharesDraftReady),
        EnglishDisplayName = CASE WHEN @setEnName = 1 THEN @enName ELSE EnglishDisplayName END,
        Notes = CASE WHEN @setNotes = 1 THEN @notes ELSE Notes END,
        OpeningCashDecision = CASE WHEN @setCashDec = 1 THEN @cashDec ELSE OpeningCashDecision END,
        OpeningCashAmount = CASE WHEN @setCashAmt = 1 THEN @cashAmt ELSE OpeningCashAmount END,
        OpeningCashEffectiveDate = CASE WHEN @setCashDate = 1 THEN @cashDate ELSE OpeningCashEffectiveDate END,
        OpeningCashReason = CASE WHEN @setCashReason = 1 THEN @cashReason ELSE OpeningCashReason END,
        OpeningCashApprovedByUserID = CASE
          WHEN @markCashNow = 1 THEN @cashBy
          ELSE OpeningCashApprovedByUserID
        END,
        OpeningCashApprovedAt = CASE
          WHEN @markCashNow = 1 THEN SYSUTCDATETIME()
          ELSE OpeningCashApprovedAt
        END,
        InternalLiveEffectiveDate = CASE WHEN @setLiveDate = 1 THEN @liveDate ELSE InternalLiveEffectiveDate END,
        UpdatedAt = SYSUTCDATETIME()
      WHERE BranchID = @branchId
    `);

  const row = await getBranchSetupPolicy(branchId);
  if (!row) throw new Error('Failed to upsert BranchSetupPolicy');
  return row;
}

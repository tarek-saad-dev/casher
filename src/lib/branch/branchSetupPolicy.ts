/**
 * Phase 1O — branch setup policy flags (shared printer / WhatsApp, opening inventory decision).
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';

export type OpeningInventoryOption = 'ZERO_STOCK' | 'NEW_PURCHASE' | 'TRANSFER_FROM_GLEEM' | null;

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
};

let ensured = false;

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
        UpdatedAt DATETIME2 NULL
      );
    END
  `);
  ensured = true;
}

function mapRow(row: Record<string, unknown>): BranchSetupPolicy {
  const opt = row.OpeningInventoryOption == null ? null : String(row.OpeningInventoryOption);
  const opening: OpeningInventoryOption =
    opt === 'ZERO_STOCK' || opt === 'NEW_PURCHASE' || opt === 'TRANSFER_FROM_GLEEM'
      ? opt
      : null;
  return {
    branchId: Number(row.BranchID),
    sharedPrinterApproved: Boolean(row.SharedPrinterApproved),
    sharedWhatsAppApproved: Boolean(row.SharedWhatsAppApproved),
    openingInventoryOption: opening,
    openingInventoryApprovedAt:
      row.OpeningInventoryApprovedAt == null
        ? null
        : row.OpeningInventoryApprovedAt instanceof Date
          ? row.OpeningInventoryApprovedAt.toISOString()
          : String(row.OpeningInventoryApprovedAt),
    openingInventoryApprovedByUserId:
      row.OpeningInventoryApprovedByUserID == null
        ? null
        : Number(row.OpeningInventoryApprovedByUserID),
    usersAccessReviewedAt:
      row.UsersAccessReviewedAt == null
        ? null
        : row.UsersAccessReviewedAt instanceof Date
          ? row.UsersAccessReviewedAt.toISOString()
          : String(row.UsersAccessReviewedAt),
    partnerSharesDraftReady: Boolean(row.PartnerSharesDraftReady),
    englishDisplayName:
      row.EnglishDisplayName == null ? null : String(row.EnglishDisplayName),
    notes: row.Notes == null ? null : String(row.Notes),
    updatedAt:
      row.UpdatedAt == null
        ? null
        : row.UpdatedAt instanceof Date
          ? row.UpdatedAt.toISOString()
          : String(row.UpdatedAt),
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
      patch.openingInventoryOption === undefined
        ? null
        : patch.openingInventoryOption,
    )
    .input('setOpenOpt', sql.Bit, patch.openingInventoryOption !== undefined ? 1 : 0)
    .input(
      'openBy',
      sql.Int,
      patch.openingInventoryApprovedByUserId === undefined
        ? null
        : patch.openingInventoryApprovedByUserId,
    )
    .input(
      'markOpenNow',
      sql.Bit,
      patch.markOpeningInventoryApprovedNow ? 1 : 0,
    )
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
        UpdatedAt = SYSUTCDATETIME()
      WHERE BranchID = @branchId
    `);

  const row = await getBranchSetupPolicy(branchId);
  if (!row) throw new Error('Failed to upsert BranchSetupPolicy');
  return row;
}

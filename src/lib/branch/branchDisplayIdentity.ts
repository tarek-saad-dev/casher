/**
 * Phase 1O — branch display identity (no new English BranchName column).
 * English display name lives in QueueBookingSettings.SalonName.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { getBranchById } from './repository';

export type BranchDisplayIdentity = {
  branchId: number;
  branchCode: string;
  /** Arabic operational name from TblBranch.BranchName */
  arabicName: string;
  shortName: string | null;
  /** English / public display — QueueBookingSettings.SalonName */
  englishDisplayName: string | null;
  address: string | null;
  phone: string | null;
  timeZone: string;
};

export async function resolveBranchDisplayIdentity(
  branchId: number,
): Promise<BranchDisplayIdentity | null> {
  const branch = await getBranchById(branchId);
  if (!branch) return null;

  const db = await getPool();
  const qbs = await db
    .request()
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT TOP 1 SalonName
      FROM dbo.QueueBookingSettings
      WHERE BranchID = @branchId
    `);
  const salon =
    qbs.recordset[0]?.SalonName == null
      ? null
      : String(qbs.recordset[0].SalonName).trim() || null;

  return {
    branchId: branch.branchId,
    branchCode: branch.branchCode,
    arabicName: branch.branchName,
    shortName: branch.shortName,
    englishDisplayName: salon,
    address: branch.address,
    phone: branch.phone,
    timeZone: branch.timeZone,
  };
}

/** Receipt / WhatsApp payload identity — never falls back to another branch's name. */
export function buildBranchMessageIdentity(identity: BranchDisplayIdentity): {
  branchDisplayName: string;
  englishDisplayName: string | null;
  phone: string | null;
  address: string | null;
  branchCode: string;
  branchId: number;
} {
  return {
    branchDisplayName: identity.arabicName,
    englishDisplayName: identity.englishDisplayName,
    phone: identity.phone,
    address: identity.address,
    branchCode: identity.branchCode,
    branchId: identity.branchId,
  };
}

export function normalizeEgyptianDisplayPhone(raw: string): string {
  const digits = String(raw).replace(/\D/g, '');
  // Keep customer-facing local form when already 01xxxxxxxxx
  if (/^01\d{9}$/.test(digits)) return digits;
  if (/^201\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
  return String(raw).trim();
}

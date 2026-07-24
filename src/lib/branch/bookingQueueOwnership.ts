/**
 * Phase 1F booking / queue branch ownership helpers.
 * Public: resolve branchCode → active branch (never silent GLEEM default).
 * Internal: assert session branch owns booking/ticket.
 * Employee eligibility: TblEmpBranchAssignment + CanReceiveBookings.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { PUBLIC_CORS_HEADERS } from '@/lib/publicBookingHelpers';
import { getBranchByCode, listActiveBranches } from './repository';
import type { BranchRecord } from './types';
import { BranchDomainError } from './types';
import { assertActiveBranchOwns, financialNotFoundResponse } from './financialOwnership';

export type PublicBranchSafe = {
  branchId: number;
  branchCode: string;
  branchName: string;
  shortName: string | null;
  address: string | null;
  phone: string | null;
  timeZone: string;
};

/** Optional context for public booking branch resolution (logging only). */
export type ResolvePublicBranchOptions = {
  /** Request path — used only when the temporary single-branch fallback fires. */
  route?: string;
};

export function toPublicBranchSafe(b: BranchRecord): PublicBranchSafe {
  return {
    branchId: b.branchId,
    branchCode: b.branchCode,
    branchName: b.branchName,
    shortName: b.shortName,
    address: b.address,
    phone: b.phone,
    timeZone: b.timeZone,
  };
}

export async function listPublicActiveBranches(): Promise<PublicBranchSafe[]> {
  const rows = await listActiveBranches();
  return rows.map(toPublicBranchSafe);
}

/** Non-disclosing invalid branch for public callers. */
export function publicInvalidBranchResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, error: 'INVALID_BRANCH', message: 'الفرع غير متاح' },
    { status: 404, headers: PUBLIC_CORS_HEADERS },
  );
}

export function publicBranchRequiredResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, error: 'BRANCH_REQUIRED', message: 'يجب اختيار الفرع' },
    { status: 400, headers: PUBLIC_CORS_HEADERS },
  );
}

export function bookingQueueNotFoundResponse(): NextResponse {
  return financialNotFoundResponse();
}

/**
 * TEMP HOTFIX — remove with public booking restructure.
 * When branchCode is missing and exactly one active public branch exists,
 * use that branch. Multiple or zero active branches → BRANCH_REQUIRED.
 * Never hardcodes a branch code; never picks TOP 1 among many.
 */
function warnSingleActiveBranchFallback(args: {
  route: string;
  resolvedBranchID: number;
  resolvedBranchCode: string;
}): void {
  console.warn(
    '[public-booking] single-active-branch compatibility fallback',
    {
      route: args.route,
      resolvedBranchID: args.resolvedBranchID,
      resolvedBranchCode: args.resolvedBranchCode,
    },
  );
}

/**
 * Resolve public branchCode (preferred) from query/body.
 * Explicit code: must exist and be active.
 * Missing code: temporary compatibility — only when exactly one active branch.
 * Never defaults to a hardcoded branch code or BranchID=1.
 */
export async function resolvePublicBranchCode(
  branchCode: string | null | undefined,
  options?: ResolvePublicBranchOptions,
): Promise<BranchRecord> {
  const raw = (branchCode ?? '').trim();
  if (raw) {
    const branch = await getBranchByCode(raw);
    if (!branch || !branch.isActive) {
      throw new BranchDomainError('BRANCH_INACTIVE', 'الفرع غير متاح', 404);
    }
    return branch;
  }

  // Missing branchCode: fail closed unless uniquely one active public branch.
  const active = await listActiveBranches();
  if (active.length === 1) {
    const only = active[0]!;
    warnSingleActiveBranchFallback({
      route: options?.route ?? 'unknown',
      resolvedBranchID: only.branchId,
      resolvedBranchCode: only.branchCode,
    });
    return only;
  }

  throw new BranchDomainError('BRANCH_REQUIRED', 'يجب اختيار الفرع', 400);
}

export function extractPublicBranchCode(
  searchParams: URLSearchParams,
  body?: Record<string, unknown> | null,
): string | null {
  const fromQuery =
    searchParams.get('branchCode') ??
    searchParams.get('branch') ??
    null;
  if (fromQuery && fromQuery.trim()) return fromQuery.trim();
  if (body) {
    const fromBody = body.branchCode ?? body.branch;
    if (typeof fromBody === 'string' && fromBody.trim()) return fromBody.trim();
  }
  return null;
}

export async function loadBookingBranchId(
  bookingId: number,
  transaction?: sql.Transaction,
): Promise<number | null> {
  const req = transaction ? new sql.Request(transaction) : (await getPool()).request();
  const result = await req
    .input('id', sql.Int, bookingId)
    .query(`SELECT BranchID FROM dbo.Bookings WHERE BookingID = @id`);
  const row = result.recordset[0];
  return row ? Number(row.BranchID) : null;
}

export async function loadQueueTicketBranchId(
  queueTicketId: number,
  transaction?: sql.Transaction,
): Promise<number | null> {
  const req = transaction ? new sql.Request(transaction) : (await getPool()).request();
  const result = await req
    .input('id', sql.Int, queueTicketId)
    .query(`SELECT BranchID FROM dbo.QueueTickets WHERE QueueTicketID = @id`);
  const row = result.recordset[0];
  return row ? Number(row.BranchID) : null;
}

export function assertBookingOwnedByActiveBranch(
  activeBranchId: number,
  bookingBranchId: number | null | undefined,
): boolean {
  return assertActiveBranchOwns(activeBranchId, bookingBranchId);
}

/**
 * Employee may receive bookings/queue work at branch on operational date.
 */
export async function isEmployeeEligibleForBranchBookings(args: {
  empId: number;
  branchId: number;
  operationalDate: string; // YYYY-MM-DD
  requireCanReceiveBookings?: boolean;
}): Promise<boolean> {
  const requireBookings = args.requireCanReceiveBookings !== false;
  const db = await getPool();
  const result = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('branchId', sql.Int, args.branchId)
    .input('day', sql.Date, args.operationalDate)
    .input('requireBookings', sql.Bit, requireBookings ? 1 : 0)
    .query(`
      SELECT TOP 1 ea.ID
      FROM dbo.TblEmpBranchAssignment ea
      INNER JOIN dbo.TblBranch b ON b.BranchID = ea.BranchID
      INNER JOIN dbo.TblEmp e ON e.EmpID = ea.EmpID
      WHERE ea.EmpID = @empId
        AND ea.BranchID = @branchId
        AND ea.IsActive = 1
        AND b.IsActive = 1
        AND ISNULL(e.isActive, 1) = 1
        AND ea.EffectiveFrom <= @day
        AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= @day)
        AND (@requireBookings = 0 OR ea.CanReceiveBookings = 1)
    `);
  return result.recordset.length > 0;
}

/** SQL fragment: employee ids assigned to branch for bookings on @day. */
export const EMP_BOOKABLE_AT_BRANCH_SQL = `
  SELECT ea.EmpID
  FROM dbo.TblEmpBranchAssignment ea
  INNER JOIN dbo.TblBranch b ON b.BranchID = ea.BranchID
  INNER JOIN dbo.TblEmp e ON e.EmpID = ea.EmpID
  WHERE ea.BranchID = @branchId
    AND ea.IsActive = 1
    AND b.IsActive = 1
    AND ISNULL(e.isActive, 1) = 1
    AND ea.CanReceiveBookings = 1
    AND ea.EffectiveFrom <= @day
    AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= @day)
`;

export async function listBookableEmployeeIdsForBranch(
  branchId: number,
  operationalDate: string,
): Promise<number[]> {
  const db = await getPool();
  const result = await db
    .request()
    .input('branchId', sql.Int, branchId)
    .input('day', sql.Date, operationalDate)
    .query(EMP_BOOKABLE_AT_BRANCH_SQL);
  return result.recordset.map((r: { EmpID: number }) => Number(r.EmpID));
}

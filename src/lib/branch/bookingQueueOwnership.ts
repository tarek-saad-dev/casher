/**
 * Phase 1F booking / queue branch ownership helpers.
 * Public: resolve branchCode → active branch (never silent GLEEM default).
 * Internal: assert session branch owns booking/ticket.
 * Employee eligibility: TblEmpBranchAssignment + CanReceiveBookings.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { BOOKING_SLOT_BARBER_JOBS_SQL_LIST } from '@/lib/availabilityEngine';
import { PUBLIC_CORS_HEADERS } from '@/lib/publicBookingHelpers';
import { getBranchByCode, listActiveBranches } from './repository';
import type { BranchRecord } from './types';
import { BranchDomainError } from './types';
import { assertActiveBranchOwns, financialNotFoundResponse } from './financialOwnership';
import { isPubliclyDiscoverable } from './lifecycle';
import { getSmokeExecutionContext } from './smokeExecutionContext';

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
  const db = await getPool();
  const out: PublicBranchSafe[] = [];
  for (const b of rows) {
    if (
      !isPubliclyDiscoverable({
        lifecycleStatus: b.lifecycleStatus,
        publicBookingEnabled: b.publicBookingEnabled,
        isActive: b.isActive,
      })
    ) {
      continue;
    }
    const qbs = await db
      .request()
      .input('branchId', sql.Int, b.branchId)
      .query(`
        SELECT TOP 1 ISNULL(BookingEnabled, 0) AS BookingEnabled
        FROM dbo.QueueBookingSettings WHERE BranchID = @branchId
      `);
    if (!qbs.recordset[0]?.BookingEnabled) continue;
    out.push(toPublicBranchSafe(b));
  }
  return out;
}

function assertPublicBookable(branch: BranchRecord): BranchRecord {
  if (
    !isPubliclyDiscoverable({
      lifecycleStatus: branch.lifecycleStatus,
      publicBookingEnabled: branch.publicBookingEnabled,
      isActive: branch.isActive,
    })
  ) {
    throw new BranchDomainError('BRANCH_INACTIVE', 'الفرع غير متاح', 404);
  }
  return branch;
}

/** Non-disclosing invalid branch for public callers. */
export function publicInvalidBranchResponse(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: 'INVALID_BRANCH',
      code: 'BRANCH_NOT_PUBLIC',
      message: 'الفرع غير متاح',
      messageEn: 'Branch is not publicly bookable',
    },
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
 * Explicit code: must exist and be publicly discoverable (PUBLIC_LIVE + PublicBookingEnabled).
 * Missing code: temporary compatibility — only when exactly one public branch.
 * Fail closed when multiple public branches exist.
 * Never defaults to a hardcoded branch code or BranchID=1.
 * PH1GTEST / SETUP / SMOKE_TEST never resolve publicly.
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
    return assertPublicBookable(branch);
  }

  // Missing branchCode: fail closed unless uniquely one public branch.
  const publicBranches = await listPublicActiveBranches();
  if (publicBranches.length === 1) {
    const onlySafe = publicBranches[0]!;
    const only = await getBranchByCode(onlySafe.branchCode);
    if (!only) {
      throw new BranchDomainError('BRANCH_REQUIRED', 'يجب اختيار الفرع', 400);
    }
    warnSingleActiveBranchFallback({
      route: options?.route ?? 'unknown',
      resolvedBranchID: only.branchId,
      resolvedBranchCode: only.branchCode,
    });
    return assertPublicBookable(only);
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
  /** Walk-in / ops: also accept active temporary transfer-in for the day. */
  includeTemporaryTransfer?: boolean;
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
        AND (
          @requireBookings = 0
          OR (
            ea.CanReceiveBookings = 1
            AND e.Job IN (${BOOKING_SLOT_BARBER_JOBS_SQL_LIST})
          )
        )
    `);
  if (result.recordset.length > 0) return true;

  if (!args.includeTemporaryTransfer) return false;

  try {
    const transfer = await db
      .request()
      .input('empId', sql.Int, args.empId)
      .input('branchId', sql.Int, args.branchId)
      .input('day', sql.Date, args.operationalDate)
      .query(`
        SELECT TOP 1 t.TransferID
        FROM dbo.TblEmpTemporaryBranchTransfer t
        INNER JOIN dbo.TblEmp e ON e.EmpID = t.EmpID
        INNER JOIN dbo.TblBranch b ON b.BranchID = t.ToBranchID
        WHERE t.EmpID = @empId
          AND t.ToBranchID = @branchId
          AND t.WorkDate = @day
          AND t.IsActive = 1
          AND b.IsActive = 1
          AND ISNULL(e.isActive, 1) = 1
      `);
    return transfer.recordset.length > 0;
  } catch {
    // Table may not exist on older DBs — fail closed to assignment-only.
    return false;
  }
}

/**
 * Walk-in / ops queue: assigned OR transferred-in; Does NOT require CanReceiveBookings.
 */
export async function listQueueEligibleEmployeeIdsForBranch(
  branchId: number,
  operationalDate: string,
): Promise<number[]> {
  const db = await getPool();
  const assigned = await db
    .request()
    .input('branchId', sql.Int, branchId)
    .input('day', sql.Date, operationalDate)
    .query(`
      SELECT ea.EmpID
      FROM dbo.TblEmpBranchAssignment ea
      INNER JOIN dbo.TblBranch b ON b.BranchID = ea.BranchID
      INNER JOIN dbo.TblEmp e ON e.EmpID = ea.EmpID
      WHERE ea.BranchID = @branchId
        AND ea.IsActive = 1
        AND b.IsActive = 1
        AND ISNULL(e.isActive, 1) = 1
        AND ea.EffectiveFrom <= @day
        AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= @day)
    `);
  const ids = new Set<number>(
    assigned.recordset.map((r: { EmpID: number }) => Number(r.EmpID)),
  );

  try {
    const transferred = await db
      .request()
      .input('branchId', sql.Int, branchId)
      .input('day', sql.Date, operationalDate)
      .query(`
        SELECT t.EmpID
        FROM dbo.TblEmpTemporaryBranchTransfer t
        INNER JOIN dbo.TblEmp e ON e.EmpID = t.EmpID
        INNER JOIN dbo.TblBranch b ON b.BranchID = t.ToBranchID
        WHERE t.ToBranchID = @branchId
          AND t.WorkDate = @day
          AND t.IsActive = 1
          AND b.IsActive = 1
          AND ISNULL(e.isActive, 1) = 1
      `);
    for (const r of transferred.recordset as Array<{ EmpID: number }>) {
      ids.add(Number(r.EmpID));
    }
  } catch {
    /* optional table */
  }

  return [...ids];
}

/**
 * SQL fragment: lead barber ids assigned to branch for bookings on @day.
 * Job = حلاق only (no cashiers, admins, or assistants) — nearest-available slots.
 */
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
    AND e.Job IN (${BOOKING_SLOT_BARBER_JOBS_SQL_LIST})
    AND ea.EffectiveFrom <= @day
    AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= @day)
`;

/** Public booking: same as above but excludes disposable [TEST]/[SMOKE] identities. */
export const EMP_BOOKABLE_AT_BRANCH_PUBLIC_SQL = `
  ${EMP_BOOKABLE_AT_BRANCH_SQL.trim()}
    AND (e.EmpName IS NULL OR (
      e.EmpName NOT LIKE N'%[[]TEST]%'
      AND e.EmpName NOT LIKE N'%[[]SMOKE%'
    ))
`;

export async function listBookableEmployeeIdsForBranch(
  branchId: number,
  operationalDate: string,
  opts?: { publicOnly?: boolean },
): Promise<number[]> {
  const db = await getPool();
  const publicOnly = opts?.publicOnly === true;
  const smokeContext = getSmokeExecutionContext();
  const useExclusion = publicOnly && !smokeContext;
  const result = await db
    .request()
    .input('branchId', sql.Int, branchId)
    .input('day', sql.Date, operationalDate)
    .query(useExclusion ? EMP_BOOKABLE_AT_BRANCH_PUBLIC_SQL : EMP_BOOKABLE_AT_BRANCH_SQL);
  return result.recordset.map((r: { EmpID: number }) => Number(r.EmpID));
}

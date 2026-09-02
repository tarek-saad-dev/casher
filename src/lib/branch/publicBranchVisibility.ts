/**
 * Phase 1Q — public vs admin branch visibility for booking/schedule.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { getBranchById } from '@/lib/branch/repository';
import { isPubliclyDiscoverable } from '@/lib/branch/lifecycle';
import { isEmployeeEligibleForBranchBookings } from '@/lib/branch/bookingQueueOwnership';

export async function canBranchAppearInPublicBooking(branchId: number): Promise<boolean> {
  const map = await canBranchesAppearInPublicBooking([branchId]);
  return map.get(branchId) === true;
}

/** Batch visibility for many branches (1 QBS query + branch loads). */
export async function canBranchesAppearInPublicBooking(
  branchIds: number[],
): Promise<Map<number, boolean>> {
  const out = new Map<number, boolean>();
  const ids = [...new Set(branchIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return out;

  const branches = await Promise.all(ids.map((id) => getBranchById(id)));
  const candidates: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    const branch = branches[i];
    const id = ids[i]!;
    if (
      !branch ||
      !isPubliclyDiscoverable({
        lifecycleStatus: branch.lifecycleStatus,
        publicBookingEnabled: branch.publicBookingEnabled,
        isActive: branch.isActive,
      })
    ) {
      out.set(id, false);
      continue;
    }
    candidates.push(id);
  }
  if (!candidates.length) return out;

  const db = await getPool();
  const req = db.request();
  candidates.forEach((id, i) => req.input(`b${i}`, sql.Int, id));
  const qbs = await req.query(`
    SELECT BranchID, ISNULL(BookingEnabled, 0) AS BookingEnabled
    FROM dbo.QueueBookingSettings
    WHERE BranchID IN (${candidates.map((_, i) => `@b${i}`).join(',')})
  `);
  const enabled = new Set<number>();
  for (const row of qbs.recordset as Array<{ BranchID: number; BookingEnabled: unknown }>) {
    if (row.BookingEnabled) enabled.add(Number(row.BranchID));
  }
  for (const id of candidates) {
    out.set(id, enabled.has(id));
  }
  return out;
}

export async function canBranchAppearInAdminSchedule(branchId: number): Promise<boolean> {
  const branch = await getBranchById(branchId);
  return Boolean(branch);
}

export async function canEmployeeOperateInBranch(args: {
  empId: number;
  branchId: number;
  workDate: string;
}): Promise<boolean> {
  const db = await getPool();
  const r = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('branchId', sql.Int, args.branchId)
    .input('day', sql.Date, args.workDate)
    .query(`
      SELECT TOP 1 1 AS X
      FROM dbo.TblEmpBranchAssignment
      WHERE EmpID = @empId AND BranchID = @branchId AND IsActive = 1
        AND EffectiveFrom <= @day
        AND (EffectiveTo IS NULL OR EffectiveTo >= @day)
    `);
  return Boolean(r.recordset[0]);
}

export async function canEmployeeReceivePublicBookings(args: {
  empId: number;
  branchId: number;
  workDate: string;
}): Promise<boolean> {
  if (!(await canBranchAppearInPublicBooking(args.branchId))) return false;
  return isEmployeeEligibleForBranchBookings({
    empId: args.empId,
    branchId: args.branchId,
    operationalDate: args.workDate,
    includeTemporaryTransfer: true,
  });
}

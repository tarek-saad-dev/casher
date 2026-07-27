/**
 * Phase 1Q — public vs admin branch visibility for booking/schedule.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { getBranchById } from '@/lib/branch/repository';
import { isPubliclyDiscoverable } from '@/lib/branch/lifecycle';
import { isEmployeeEligibleForBranchBookings } from '@/lib/branch/bookingQueueOwnership';

export async function canBranchAppearInPublicBooking(branchId: number): Promise<boolean> {
  const branch = await getBranchById(branchId);
  if (!branch) return false;
  if (
    !isPubliclyDiscoverable({
      lifecycleStatus: branch.lifecycleStatus,
      publicBookingEnabled: branch.publicBookingEnabled,
      isActive: branch.isActive,
    })
  ) {
    return false;
  }
  const db = await getPool();
  const qbs = await db
    .request()
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT TOP 1 ISNULL(BookingEnabled, 0) AS BookingEnabled
      FROM dbo.QueueBookingSettings WHERE BranchID = @branchId
    `);
  return Boolean(qbs.recordset[0]?.BookingEnabled);
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
  });
}

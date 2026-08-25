/**
 * Repair IsActive / public flags when they drift from LifecycleStatus.
 * Does not change LifecycleStatus — use transitionBranchLifecycle for stage changes.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { capabilitiesFor } from './lifecycle';
import { getBranchById } from './repository';
import type { BranchLifecycleStatus, BranchRecord } from './types';
import { BranchDomainError } from './types';

export type SyncOperationalFlagsResult = {
  branchId: number;
  branchCode: string;
  changed: boolean;
  before: Pick<
    BranchRecord,
    'lifecycleStatus' | 'isActive' | 'publicBookingEnabled' | 'externalNotificationsEnabled'
  >;
  after: Pick<
    BranchRecord,
    'lifecycleStatus' | 'isActive' | 'publicBookingEnabled' | 'externalNotificationsEnabled'
  >;
};

function expectedFlags(lifecycleStatus: BranchLifecycleStatus) {
  const caps = capabilitiesFor(lifecycleStatus);
  return {
    isActive: caps.isActive,
    publicBookingEnabled: lifecycleStatus === 'PUBLIC_LIVE',
    externalNotificationsEnabled: caps.externalNotifications,
  };
}

export async function syncOperationalFlagsFromLifecycle(
  branchId: number,
): Promise<SyncOperationalFlagsResult> {
  const branch = await getBranchById(branchId);
  if (!branch) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'الفرع غير موجود', 404);
  }

  const before = {
    lifecycleStatus: branch.lifecycleStatus,
    isActive: branch.isActive,
    publicBookingEnabled: branch.publicBookingEnabled,
    externalNotificationsEnabled: branch.externalNotificationsEnabled,
  };

  const expected = expectedFlags(branch.lifecycleStatus);
  const mismatch =
    branch.isActive !== expected.isActive ||
    branch.publicBookingEnabled !== expected.publicBookingEnabled ||
    branch.externalNotificationsEnabled !== expected.externalNotificationsEnabled;

  if (!mismatch) {
    return {
      branchId: branch.branchId,
      branchCode: branch.branchCode,
      changed: false,
      before,
      after: before,
    };
  }

  const db = await getPool();
  await db
    .request()
    .input('branchId', sql.Int, branch.branchId)
    .input('isActive', sql.Bit, expected.isActive ? 1 : 0)
    .input('publicBooking', sql.Bit, expected.publicBookingEnabled ? 1 : 0)
    .input('extNotify', sql.Bit, expected.externalNotificationsEnabled ? 1 : 0)
    .query(`
      UPDATE dbo.TblBranch
      SET IsActive = @isActive,
          PublicBookingEnabled = @publicBooking,
          ExternalNotificationsEnabled = @extNotify,
          UpdatedAt = SYSUTCDATETIME()
      WHERE BranchID = @branchId
    `);

  if (branch.lifecycleStatus !== 'PUBLIC_LIVE') {
    await db
      .request()
      .input('branchId', sql.Int, branch.branchId)
      .input('bookingEnabled', sql.Bit, expected.publicBookingEnabled ? 1 : 0)
      .query(`
        UPDATE dbo.QueueBookingSettings
        SET BookingEnabled = @bookingEnabled, UpdatedAt = GETDATE()
        WHERE BranchID = @branchId
      `);
  }

  const afterBranch = await getBranchById(branch.branchId);
  const after = afterBranch
    ? {
        lifecycleStatus: afterBranch.lifecycleStatus,
        isActive: afterBranch.isActive,
        publicBookingEnabled: afterBranch.publicBookingEnabled,
        externalNotificationsEnabled: afterBranch.externalNotificationsEnabled,
      }
    : before;

  console.info(
    JSON.stringify({
      event: 'branch.operational_flags.synced',
      branchId: branch.branchId,
      branchCode: branch.branchCode,
      lifecycleStatus: branch.lifecycleStatus,
      before,
      after,
    }),
  );

  return {
    branchId: branch.branchId,
    branchCode: branch.branchCode,
    changed: true,
    before,
    after,
  };
}

import type { BranchRecord } from './types';

/** JSON-safe branch payload for admin APIs. */
export function serializeBranch(branch: BranchRecord) {
  return {
    branchId: branch.branchId,
    branchCode: branch.branchCode,
    branchName: branch.branchName,
    shortName: branch.shortName,
    address: branch.address,
    phone: branch.phone,
    timeZone: branch.timeZone,
    businessDayCutoffTime: branch.businessDayCutoffTime?.slice(0, 8) ?? '',
    defaultOpenTime: branch.defaultOpenTime?.slice(0, 8) ?? null,
    defaultCloseTime: branch.defaultCloseTime?.slice(0, 8) ?? null,
    isActive: branch.isActive,
    lifecycleStatus: branch.lifecycleStatus,
    publicBookingEnabled: branch.publicBookingEnabled,
    externalNotificationsEnabled: branch.externalNotificationsEnabled,
    createdAt: branch.createdAt.toISOString(),
    updatedAt: branch.updatedAt?.toISOString() ?? null,
  };
}

export type SerializedBranch = ReturnType<typeof serializeBranch>;

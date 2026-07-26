/**
 * Phase 1R — targeted availability / ops cache invalidation after schedule or transfer changes.
 * Prefer scoped keys; avoid production-wide flush.
 */
import 'server-only';
import { invalidatePublicSettingsCache } from '@/lib/publicBookingHelpers';

export type ScheduleInvalidationScope = {
  empId: number;
  workDate?: string;
  branchIds?: number[];
};

const dayStateVersion = new Map<string, number>();

function bump(key: string) {
  dayStateVersion.set(key, (dayStateVersion.get(key) ?? 0) + 1);
}

/** Version token for ops day-state / flow-board clients (in-process). */
export function getOperationsDayStateVersion(branchId: number, workDate: string): number {
  return dayStateVersion.get(`${branchId}:${workDate}`) ?? 0;
}

export function invalidateEmployeeScheduleCaches(scope: ScheduleInvalidationScope): void {
  const branches = scope.branchIds ?? [];
  for (const branchId of branches) {
    invalidatePublicSettingsCache(branchId);
    if (scope.workDate) bump(`${branchId}:${scope.workDate}`);
  }
  if (scope.workDate) {
    bump(`emp:${scope.empId}:${scope.workDate}`);
  }
  bump(`emp:${scope.empId}:global`);
}

export function invalidateTemporaryTransferCaches(args: {
  empId: number;
  workDate: string;
  fromBranchId: number;
  toBranchId: number;
}): void {
  invalidateEmployeeScheduleCaches({
    empId: args.empId,
    workDate: args.workDate,
    branchIds: [args.fromBranchId, args.toBranchId],
  });
}

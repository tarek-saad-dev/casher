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

  // B8.6 — date-scoped hot availability via central notifier (best-effort).
  if (scope.workDate) {
    void import('@/lib/booking/AvailabilityMutationNotifier')
      .then((m) => {
        if (branches.length) {
          return Promise.all(
            branches.map((branchId) =>
              m.AvailabilityMutationNotifier.employeeDayChanged({
                employeeId: scope.empId,
                branchId,
                businessDate: scope.workDate!,
                reason: 'schedule_invalidate',
              }),
            ),
          );
        }
        return m.AvailabilityMutationNotifier.employeeDayChanged({
          employeeId: scope.empId,
          branchId: 0,
          businessDate: scope.workDate!,
          reason: 'schedule_invalidate',
        });
      })
      .catch(() => undefined);
  }
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

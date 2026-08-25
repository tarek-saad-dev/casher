export const BOOTSTRAP_REVALIDATE_DEBOUNCE_MS = 2000;

/** Skip a focus/reconnect revalidation if one just ran. */
export function shouldSkipBootstrapRevalidate(
  lastStartedAt: number | null,
  now = Date.now(),
  windowMs = BOOTSTRAP_REVALIDATE_DEBOUNCE_MS,
): boolean {
  if (lastStartedAt == null) return false;
  return now - lastStartedAt < windowMs;
}

export function mapBootstrapToSessionShapes(data: import('@/modules/operations/domain/bootstrapTypes').OperationalBootstrap) {
  const viewBranch = data.view?.branch ?? data.activeBranch;
  const viewDay = data.view?.businessDay ?? data.activeBranchState.businessDay;
  const shift = data.operational.shift;
  return {
    user: {
      UserID: data.user.userId,
      UserName: data.user.userName,
      UserLevel: data.user.userLevel,
      ActiveBranchID: viewBranch.branchId,
      ActiveBranchCode: viewBranch.branchCode,
      BranchSessionVersion: 1 as const,
    },
    day: viewDay
      ? {
          ID: viewDay.id,
          NewDay: viewDay.businessDate,
          Status: viewDay.status,
          BranchID: viewDay.branchId,
        }
      : null,
    shift: shift
      ? {
          ID: shift.id,
          NewDay: shift.newDay,
          UserID: shift.userId,
          ShiftID: shift.shiftId,
          StartDate: shift.newDay,
          StartTime: shift.startTime ?? '',
          EndDate: null,
          EndTime: null,
          Status: shift.status,
          UserName: shift.userName ?? undefined,
          ShiftName: shift.shiftName ?? undefined,
          BranchID: shift.branchId,
          BusinessDayID: shift.businessDayId,
        }
      : null,
    viewBranch: {
      branchId: viewBranch.branchId,
      branchCode: viewBranch.branchCode,
      branchName: viewBranch.branchName,
      shortName: viewBranch.shortName,
    },
    /** Compatibility alias of viewBranch. */
    activeBranch: {
      branchId: viewBranch.branchId,
      branchCode: viewBranch.branchCode,
      branchName: viewBranch.branchName,
      shortName: viewBranch.shortName,
    },
    operationalBranch: data.operational.branch
      ? {
          branchId: data.operational.branch.branchId,
          branchCode: data.operational.branch.branchCode,
          branchName: data.operational.branch.branchName,
          shortName: data.operational.branch.shortName,
        }
      : null,
  };
}

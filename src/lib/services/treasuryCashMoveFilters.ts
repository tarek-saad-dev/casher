/**
 * Shared branch-safe WHERE fragments for TblCashMove queries that
 * LEFT JOIN dbo.TblShiftMove AS sm.
 *
 * When branchScoped is true, callers must bind @branchId and typically
 * also include cm.BranchID = @branchId.
 */

export type TreasuryCashMoveFilterParams = {
  newDay?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  shiftMoveId?: number | null;
  userId?: number | null;
};

/**
 * Append filters that keep treasury reads on the active branch only.
 * Prevents other-branch shifts (same calendar NewDay) from leaking into
 * day filters, shift dropdown selections, or user attribution joins.
 */
export function appendTreasuryCashMoveFilters(
  whereConditions: string[],
  params: Record<string, string | number>,
  filters: TreasuryCashMoveFilterParams,
  options?: { branchScoped?: boolean },
): void {
  const branchScoped = options?.branchScoped !== false;

  if (branchScoped) {
    // Never attribute / match via another branch's shift row
    whereConditions.push('(sm.ID IS NULL OR sm.BranchID = @branchId)');
  }

  if (filters.newDay != null && filters.newDay !== '') {
    if (branchScoped) {
      // Prefer branch-owned business day on the cash row; fall back for legacy
      // rows that only have shift NewDay populated.
      whereConditions.push(`(
        EXISTS (
          SELECT 1 FROM [dbo].[TblNewDay] d
          WHERE d.ID = cm.BusinessDayID
            AND d.BranchID = @branchId
            AND d.NewDay = @newDay
        )
        OR (
          cm.BusinessDayID IS NULL
          AND sm.NewDay = @newDay
          AND sm.BranchID = @branchId
        )
      )`);
    } else {
      whereConditions.push('sm.NewDay = @newDay');
    }
    params.newDay = filters.newDay;
  }

  if (filters.dateFrom && filters.dateTo) {
    whereConditions.push('cm.invDate >= @dateFrom AND cm.invDate <= @dateTo');
    params.dateFrom = filters.dateFrom;
    params.dateTo = filters.dateTo;
  } else if (filters.dateFrom) {
    whereConditions.push('cm.invDate >= @dateFrom');
    params.dateFrom = filters.dateFrom;
  } else if (filters.dateTo) {
    whereConditions.push('cm.invDate <= @dateTo');
    params.dateTo = filters.dateTo;
  }

  if (filters.shiftMoveId != null && !Number.isNaN(filters.shiftMoveId)) {
    whereConditions.push('sm.ID = @shiftMoveId');
    params.shiftMoveId = filters.shiftMoveId;
  }

  if (filters.userId != null && !Number.isNaN(filters.userId)) {
    whereConditions.push('sm.UserID = @userId');
    params.userId = filters.userId;
  }
}

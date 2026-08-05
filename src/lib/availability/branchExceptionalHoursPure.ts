/**
 * Pure helpers for branch exceptional hours containment (no DB).
 */

export type BranchExceptionalHoursLike = {
  isClosed: boolean;
  openTime: string | null;
  endTime: string | null;
  endDayOffset: 0 | 1;
};

/** True when [start,end) fits inside exceptional open hours (or default hours when no exception). */
export function windowWithinBranchHours(args: {
  windowStart: string;
  windowEnd: string;
  windowEndDayOffset: 0 | 1;
  branchOpen: string;
  branchClose: string;
  branchCloseDayOffset: 0 | 1;
  exceptional: BranchExceptionalHoursLike | null;
}): { ok: boolean; reasonCode?: 'BRANCH_CLOSED' | 'OUTSIDE_BRANCH_HOURS' } {
  if (args.exceptional?.isClosed) {
    return { ok: false, reasonCode: 'BRANCH_CLOSED' };
  }
  const open = args.exceptional?.openTime ?? args.branchOpen;
  const close = args.exceptional?.endTime ?? args.branchClose;
  const closeOff = args.exceptional?.endDayOffset ?? args.branchCloseDayOffset;

  const toMin = (hhmm: string, dayOff: number) => {
    const [h, m] = hhmm.split(':').map(Number);
    return dayOff * 24 * 60 + h * 60 + m;
  };
  const wStart = toMin(args.windowStart, 0);
  const wEnd = toMin(args.windowEnd, args.windowEndDayOffset);
  const bStart = toMin(open, 0);
  const bEnd = toMin(close, closeOff);
  if (wStart < bStart || wEnd > bEnd) {
    return { ok: false, reasonCode: 'OUTSIDE_BRANCH_HOURS' };
  }
  return { ok: true };
}

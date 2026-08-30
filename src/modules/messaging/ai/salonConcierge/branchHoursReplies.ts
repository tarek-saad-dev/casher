import type { ConciergeBranchCode } from './branchBusinessHours';
import {
  cairoNowMinutes,
  formatConciergeAllBranchSchedules,
  formatConciergeBranchSchedule,
  formatConciergeOpenNowAll,
  formatConciergeOpenNowSingle,
} from './branchBusinessHours';

export function buildFixedOpenNowReply(args: {
  branchCode: ConciergeBranchCode | null;
  nowMinutes?: number;
}): string {
  const now = args.nowMinutes ?? cairoNowMinutes();
  if (args.branchCode) {
    return formatConciergeOpenNowSingle(args.branchCode, now);
  }
  return formatConciergeOpenNowAll(now);
}

export function buildFixedHoursScheduleReply(args: {
  branchCode: ConciergeBranchCode | null;
}): string {
  if (args.branchCode) {
    return formatConciergeBranchSchedule(args.branchCode);
  }
  return formatConciergeAllBranchSchedules();
}

/**
 * Admin PUT attendance — current production semantics (Phase B1).
 * OPEN is other-branch + any WorkDate. WorkDate is caller-supplied.
 * Runtime Behavior Changes: NONE
 */

export const ADMIN_PUT_ALREADY_OPEN_CODE = 'ALREADY_OPEN' as const;

export const ADMIN_PUT_ALREADY_OPEN_MESSAGE =
  'الموظف لديه حضور مفتوح في فرع آخر — سجّل الانصراف أولاً';

/** Shared conflict contract for all punch creators (policy cutover). */
export const ACTIVE_SESSION_ALREADY_OPEN_CODE = ADMIN_PUT_ALREADY_OPEN_CODE;
export const ACTIVE_SESSION_ALREADY_OPEN_MESSAGE = ADMIN_PUT_ALREADY_OPEN_MESSAGE;

export const ADMIN_PUT_WORK_ON_DAY_OFF_REASON =
  'نزل يشتغل يوم إجازته — تسجيل حضور';

export const ADMIN_PUT_WORK_ON_DAY_OFF_SOURCE_TAG = 'work-on-day-off';

export const ADMIN_PUT_MANUAL_STATUSES = ['Absent', 'DayOff', 'Excused'] as const;

export const ADMIN_PUT_VALID_STATUSES = [
  'Pending',
  'Present',
  'Late',
  'Absent',
  'DayOff',
  'EarlyLeave',
  'Excused',
] as const;

export type AdminPutAttendanceStatus = (typeof ADMIN_PUT_VALID_STATUSES)[number];

export class AttendanceCommandError extends Error {
  readonly statusCode: number;
  readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'AttendanceCommandError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** Current server status resolution for admin PUT. Do not redesign in B1. */
export function resolveAdminPutAttendanceStatus(args: {
  clientStatus: string | undefined;
  checkInTime: string | null | undefined;
  checkOutTime: string | null | undefined;
  lateMinutes: number;
  earlyLeaveMinutes: number;
}): string {
  let finalStatus = args.clientStatus || 'Pending';
  const manualStatuses: readonly string[] = ADMIN_PUT_MANUAL_STATUSES;
  if (!manualStatuses.includes(finalStatus)) {
    if (args.checkInTime) {
      finalStatus = args.lateMinutes > 0 ? 'Late' : 'Present';
    }
    if (
      args.checkOutTime &&
      args.earlyLeaveMinutes > 0 &&
      finalStatus === 'Present'
    ) {
      finalStatus = 'EarlyLeave';
    }
  }
  return finalStatus;
}

export type SaveAdminAttendanceInput = {
  branchId: number;
  userId: number | null;
  empId: unknown;
  workDate: string;
  checkInTime?: unknown;
  checkOutTime?: unknown;
  status?: unknown;
  notes?: unknown;
  breaks?: unknown;
  breakTimes?: unknown;
};

export type SaveAdminAttendanceResult = {
  EmpID: unknown;
  WorkDate: string;
  Status: string;
  LateMinutes: number;
  EarlyLeaveMinutes: number;
  BreakMinutesTotal: number | undefined;
  Breaks: unknown;
  BreakTimeMinutesTotal: number | undefined;
  BreakTimes: unknown;
};

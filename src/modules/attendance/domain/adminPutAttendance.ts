/**
 * Admin PUT attendance — current production semantics (Phase B1).
 * OPEN is other-branch + any WorkDate. WorkDate is caller-supplied.
 *
 * Invariant: Present / Late / EarlyLeave require CheckInTime.
 * Without check-in those statuses must not persist (blocks branch payroll).
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

/** Statuses that imply payable attendance and therefore need a check-in. */
export const ADMIN_PUT_PAYABLE_STATUSES = [
  'Present',
  'Late',
  'EarlyLeave',
] as const;

export const PAYABLE_WITHOUT_CHECKIN_CODE = 'PAYABLE_WITHOUT_CHECKIN' as const;

export const PAYABLE_WITHOUT_CHECKIN_MESSAGE =
  'لا يمكن تسجيل حاضر/متأخر/انصراف مبكر بدون وقت حضور';

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

export function isAdminPutPayableStatus(
  status: string | null | undefined,
): boolean {
  return (ADMIN_PUT_PAYABLE_STATUSES as readonly string[]).includes(
    String(status ?? ''),
  );
}

/**
 * Reject explicit Present/Late/EarlyLeave when check-in is missing.
 * Call before persist on admin PUT / bulk.
 */
export function assertPayableStatusHasCheckIn(
  status: string | null | undefined,
  checkInTime: string | null | undefined,
): void {
  if (isAdminPutPayableStatus(status) && !checkInTime) {
    throw new AttendanceCommandError(
      PAYABLE_WITHOUT_CHECKIN_MESSAGE,
      400,
      PAYABLE_WITHOUT_CHECKIN_CODE,
    );
  }
}

/**
 * Resolve persisted status for admin PUT / bulk.
 * Manual statuses (Absent/DayOff/Excused) are trusted.
 * Otherwise status is derived from punches — never Present/Late/EarlyLeave without check-in.
 */
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
      if (
        args.checkOutTime &&
        args.earlyLeaveMinutes > 0 &&
        finalStatus === 'Present'
      ) {
        finalStatus = 'EarlyLeave';
      }
    } else {
      // Belt-and-suspenders: never persist payable without check-in.
      finalStatus = 'Pending';
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

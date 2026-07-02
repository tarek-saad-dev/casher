import type {
  BadgeVariant,
  DailyAttendanceStatusCode,
  NormalizedDailyStatus,
} from './employee-monthly-work-revenue.types';

export interface DailyStatusInput {
  isFutureDate: boolean;
  isScheduledWorkDay: boolean;
  isDayOff: boolean;
  checkIn: string | null;
  checkOut: string | null;
  attendanceStatus: string | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
}

const STATUS_LABELS: Record<DailyAttendanceStatusCode, string> = {
  present: 'حاضر',
  late: 'متأخر',
  early_leave: 'انصراف مبكر',
  late_and_early: 'متأخر وانصرف مبكرًا',
  absent: 'غائب',
  day_off: 'إجازة',
  unscheduled: 'يوم غير مجدول',
  no_attendance_record: 'لم يسجل حضور',
  incomplete_checkout: 'لم يسجل انصراف',
  future_scheduled: 'مجدول لاحقًا',
  excused: 'معذور',
  pending: 'قيد الانتظار',
};

const STATUS_BADGE: Record<DailyAttendanceStatusCode, BadgeVariant> = {
  present: 'success',
  late: 'warning',
  early_leave: 'warning',
  late_and_early: 'warning',
  absent: 'danger',
  day_off: 'muted',
  unscheduled: 'neutral',
  no_attendance_record: 'info',
  incomplete_checkout: 'warning',
  future_scheduled: 'info',
  excused: 'muted',
  pending: 'neutral',
};

function mapAttendanceStatus(status: string | null): DailyAttendanceStatusCode | null {
  if (!status) return null;
  const normalized = status.trim();
  switch (normalized) {
    case 'Present':
      return 'present';
    case 'Late':
      return 'late';
    case 'EarlyLeave':
      return 'early_leave';
    case 'Absent':
      return 'absent';
    case 'DayOff':
      return 'day_off';
    case 'Excused':
      return 'excused';
    case 'Pending':
      return 'pending';
    default:
      return null;
  }
}

/** Single server-side normalization for daily attendance display status. */
export function normalizeDailyAttendanceStatus(input: DailyStatusInput): NormalizedDailyStatus {
  const {
    isFutureDate,
    isScheduledWorkDay,
    isDayOff,
    checkIn,
    checkOut,
    attendanceStatus,
    lateMinutes,
    earlyLeaveMinutes,
  } = input;

  if (isFutureDate) {
    if (isDayOff) {
      return build('day_off');
    }
    if (isScheduledWorkDay) {
      return build('future_scheduled');
    }
    return build('unscheduled');
  }

  if (isDayOff) {
    return build('day_off');
  }

  if (!isScheduledWorkDay) {
    if (checkIn) {
      if (!checkOut) return build('incomplete_checkout');
      if (lateMinutes > 0 && earlyLeaveMinutes > 0) return build('late_and_early');
      if (lateMinutes > 0) return build('late');
      if (earlyLeaveMinutes > 0) return build('early_leave');
      return build('present');
    }
    return build('unscheduled');
  }

  const mapped = mapAttendanceStatus(attendanceStatus);

  if (mapped === 'absent') return build('absent');
  if (mapped === 'day_off') return build('day_off');
  if (mapped === 'excused') return build('excused');

  if (checkIn && !checkOut) {
    return build('incomplete_checkout');
  }

  if (!checkIn) {
    if (mapped === 'pending' || !attendanceStatus) {
      return build('no_attendance_record');
    }
    return build('no_attendance_record');
  }

  if (lateMinutes > 0 && earlyLeaveMinutes > 0) return build('late_and_early');
  if (lateMinutes > 0) return build('late');
  if (earlyLeaveMinutes > 0) return build('early_leave');

  if (mapped === 'late') return build('late');
  if (mapped === 'early_leave') return build('early_leave');
  if (mapped === 'present') return build('present');

  return build('present');
}

function build(code: DailyAttendanceStatusCode): NormalizedDailyStatus {
  return {
    statusCode: code,
    statusLabelAr: STATUS_LABELS[code],
    badgeVariant: STATUS_BADGE[code],
  };
}

export function getMonthDateRange(year: number, month: number): {
  startDate: string;
  endDateExclusive: string;
  endDate: string;
  calendarDays: number;
} {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const endDateExclusive = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  const calendarDays = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(calendarDays).padStart(2, '0')}`;
  return { startDate, endDateExclusive, endDate, calendarDays };
}

export function generateMonthDates(year: number, month: number, calendarDays: number): string[] {
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  return Array.from({ length: calendarDays }, (_, i) => {
    return `${prefix}${String(i + 1).padStart(2, '0')}`;
  });
}

export function getCairoTodayStr(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

export function getCairoNowParts(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(new Date());

  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  return { year, month };
}

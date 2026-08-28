import type { PayrollGapDayCategory, PayrollGapDayRow } from '@/lib/types/payroll-gap-review';

const NON_PAYABLE_STATUSES = new Set(['DayOff', 'Absent', 'Excused', 'إجازة', 'غائب']);

const CATEGORY_LABELS: Record<PayrollGapDayCategory, string> = {
  ok: 'يومية متولّدة',
  future: 'يوم مستقبلي',
  schedule_off: 'يوم إجازة (جدول)',
  schedule_off_with_payroll: 'يوم إجازة + يومية (خطأ)',
  missing_payroll: 'حضور بدون يومية',
  incomplete_attendance: 'حضور ناقص (بدون خروج)',
  attendance_no_payroll: 'حضور بدون يومية',
  no_attendance: 'بدون حضور',
  non_payable_no_payroll: 'إجازة/غياب — بدون يومية',
  posted_payroll: 'يومية مرحّلة للخزنة',
};

export function classifyDay(params: {
  workDate: string;
  reviewThroughDate: string;
  isScheduledOff: boolean;
  hasAttendance: boolean;
  attendanceStatus: string | null;
  checkIn: string | null;
  checkOut: string | null;
  hasPayroll: boolean;
  payrollStatus: string | null;
}): Pick<PayrollGapDayRow, 'category' | 'categoryLabelAr' | 'actionable' | 'suggestedActionAr'> {
  const {
    workDate,
    reviewThroughDate,
    isScheduledOff,
    hasAttendance,
    attendanceStatus,
    checkIn,
    checkOut,
    hasPayroll,
    payrollStatus,
  } = params;

  const dayLabel = arabicDayName(workDate);

  if (workDate > reviewThroughDate) {
    return {
      category: 'future',
      categoryLabelAr: CATEGORY_LABELS.future,
      actionable: false,
      suggestedActionAr: 'لا يُولَّد قبل حلول اليوم',
    };
  }

  if (isScheduledOff) {
    const status = attendanceStatus ?? '';
    const workedOnScheduledOff =
      hasAttendance &&
      !NON_PAYABLE_STATUSES.has(status) &&
      (checkIn != null || status === 'Present' || status === 'Late' || status === 'EarlyLeave');

    if (!workedOnScheduledOff) {
      const offLabel = `إجازة ${dayLabel}`;
      if (hasPayroll && payrollStatus !== 'PostedToCashMove') {
        return {
          category: 'schedule_off_with_payroll',
          categoryLabelAr: `${dayLabel} + يومية (خطأ)`,
          actionable: true,
          suggestedActionAr: `تسجيل ${offLabel} وحذف اليومية`,
        };
      }
      if (hasPayroll && payrollStatus === 'PostedToCashMove') {
        return {
          category: 'posted_payroll',
          categoryLabelAr: CATEGORY_LABELS.posted_payroll,
          actionable: false,
          suggestedActionAr: 'يومية مرحّلة — لا يمكن الحذف تلقائياً',
        };
      }
      return {
        category: 'schedule_off',
        categoryLabelAr: offLabel,
        actionable: !hasAttendance || attendanceStatus !== 'DayOff',
        suggestedActionAr: `تسجيل ${offLabel}`,
      };
    }
  }

  if (hasPayroll) {
    if (payrollStatus === 'PostedToCashMove') {
      return {
        category: 'posted_payroll',
        categoryLabelAr: CATEGORY_LABELS.posted_payroll,
        actionable: false,
        suggestedActionAr: null,
      };
    }
    return {
      category: 'ok',
      categoryLabelAr: CATEGORY_LABELS.ok,
      actionable: false,
      suggestedActionAr: null,
    };
  }

  if (!hasAttendance) {
    return {
      category: 'no_attendance',
      categoryLabelAr: CATEGORY_LABELS.no_attendance,
      actionable: true,
      suggestedActionAr: 'تعيين الحضور ثم توليد اليومية',
    };
  }

  const status = attendanceStatus ?? '';
  if (NON_PAYABLE_STATUSES.has(status)) {
    return {
      category: 'non_payable_no_payroll',
      categoryLabelAr: CATEGORY_LABELS.non_payable_no_payroll,
      actionable: false,
      suggestedActionAr: null,
    };
  }

  if (checkIn && !checkOut) {
    return {
      category: 'incomplete_attendance',
      categoryLabelAr: CATEGORY_LABELS.incomplete_attendance,
      actionable: true,
      suggestedActionAr: 'إكمال وقت الخروج ثم توليد اليومية',
    };
  }

  if (!checkIn || !checkOut) {
    return {
      category: 'incomplete_attendance',
      categoryLabelAr: CATEGORY_LABELS.incomplete_attendance,
      actionable: true,
      suggestedActionAr: 'إكمال الحضور ثم توليد اليومية',
    };
  }

  return {
    category: 'attendance_no_payroll',
    categoryLabelAr: CATEGORY_LABELS.attendance_no_payroll,
    actionable: true,
    suggestedActionAr: 'توليد اليومية',
  };
}

export function canAssignDayAttendance(
  row: Pick<PayrollGapDayRow, 'workDate' | 'category' | 'hasAttendance'>,
  reviewThroughDate: string,
): boolean {
  if (row.workDate > reviewThroughDate) return false;
  if (row.hasAttendance) return false;
  return row.category === 'no_attendance';
}

export function canGenerateDayPayroll(
  row: Pick<
    PayrollGapDayRow,
    | 'workDate'
    | 'hasPayroll'
    | 'payrollStatus'
    | 'hasAttendance'
    | 'attendanceStatus'
    | 'checkIn'
  >,
  reviewThroughDate: string,
): boolean {
  if (row.workDate > reviewThroughDate) return false;
  if (row.hasPayroll) return false;
  if (row.payrollStatus === 'PostedToCashMove') return false;
  if (!row.hasAttendance) return false;
  const status = row.attendanceStatus ?? '';
  if (NON_PAYABLE_STATUSES.has(status)) return false;
  if (!row.checkIn) return false;
  return true;
}

export function arabicDayName(workDate: string): string {
  const names = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  return names[new Date(`${workDate}T12:00:00`).getDay()] ?? workDate;
}

export function eachDateInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (cur <= end) {
    const y = cur.getFullYear();
    const mo = String(cur.getMonth() + 1).padStart(2, '0');
    const day = String(cur.getDate()).padStart(2, '0');
    out.push(`${y}-${mo}-${day}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

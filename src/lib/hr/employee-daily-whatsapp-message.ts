/**
 * Pure Arabic WhatsApp message composer for employee end-of-day report.
 */

import type { EmployeeMonthlyPayrollDayRow } from '@/lib/reports/employee-monthly-payroll.types';
import {
  formatCurrencyAr,
  formatDurationAr,
  formatTime12hAr,
} from '@/lib/reports/reportFormatters';

export interface ComposeEmployeeDailyWhatsAppInput {
  employeeName: string;
  branchName: string;
  workDate: string;
  dayNameAr: string;
  day: EmployeeMonthlyPayrollDayRow | null;
  ledgerBalance: number;
}

function hoursLabel(hours: number | null | undefined): string {
  if (hours == null) return '—';
  return formatDurationAr(Math.round(hours * 60));
}

function money(value: number | null | undefined): string {
  if (value == null) return '—';
  return formatCurrencyAr(value);
}

/** Short day header like: الأحد · 6 يوليو 2026 */
export function formatWorkDateHeadingAr(workDate: string, dayNameAr: string): string {
  const d = new Date(`${workDate}T12:00:00`);
  const dayNum = d.toLocaleDateString('ar-EG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Cairo',
  });
  return `${dayNameAr} · ${dayNum}`;
}

export function shouldSkipEmptyDayOff(day: EmployeeMonthlyPayrollDayRow | null): boolean {
  if (!day) return false;
  if (!day.isDayOff) return false;
  if (day.checkIn) return false;
  if ((day.baseWage ?? 0) > 0) return false;
  if ((day.targetAmount ?? 0) > 0) return false;
  if (day.deductions > 0 || day.advances > 0) return false;
  return true;
}

export function composeEmployeeDailyWhatsAppMessage(
  input: ComposeEmployeeDailyWhatsAppInput,
): string {
  const { employeeName, branchName, workDate, dayNameAr, day, ledgerBalance } = input;
  const heading = formatWorkDateHeadingAr(workDate, dayNameAr);
  const lines: string[] = [
    `🌙 تقرير يومك — ${branchName}`,
    heading,
    `يا ${employeeName}`,
    '',
  ];

  if (!day || day.isFutureDate) {
    lines.push('مفيش بيانات حضور مسجّلة لليوم ده لسه.');
    lines.push('');
    lines.push('━━━━━━━━━━━━');
    lines.push(`📒 رصيد حسابك حتى الآن: ${money(ledgerBalance)}`);
    return lines.join('\n');
  }

  if (day.isDayOff && !day.checkIn) {
    lines.push('📅 إجازة / يوم راحة');
    lines.push('');
    lines.push('━━━━━━━━━━━━');
    lines.push(`📒 رصيد حسابك حتى الآن: ${money(ledgerBalance)}`);
    lines.push('');
    lines.push('لو في أي ملاحظة، كلّم الإدارة 🙂');
    return lines.join('\n');
  }

  if (!day.checkIn && (day.statusCode === 'absent' || day.statusCode === 'no_attendance_record')) {
    lines.push('⚠️ الحالة: غائب');
    lines.push('مفيش حضور مسجّل النهاردة.');
    lines.push('');
    lines.push('━━━━━━━━━━━━');
    lines.push(`📒 رصيد حسابك حتى الآن: ${money(ledgerBalance)}`);
    return lines.join('\n');
  }

  lines.push('⏱ الحضور');
  lines.push(`حضور: ${formatTime12hAr(day.checkIn) ?? '—'}`);
  lines.push(
    `انصراف: ${day.checkOutLabelAr ?? formatTime12hAr(day.checkOut) ?? '—'}`,
  );
  if (day.breakMinutes > 0) {
    lines.push(`مستقطع: ${day.breakMinutes} د`);
  }
  const hoursLine =
    day.scheduledHours != null && day.actualHours != null
      ? `ساعات: ${hoursLabel(day.actualHours)} من ${hoursLabel(day.scheduledHours)}`
      : `ساعات: ${hoursLabel(day.actualHours)}`;
  lines.push(hoursLine);
  lines.push(`الحالة: ${day.statusLabelAr}`);
  if (day.lateMinutes > 0) {
    lines.push(`تأخير: ${day.lateMinutes} د`);
  }
  if (day.earlyLeaveMinutes > 0) {
    lines.push(`انصراف مبكر: ${day.earlyLeaveMinutes} د`);
  }
  lines.push('');

  lines.push('💰 الأساسي');
  lines.push(money(day.baseWage));
  if (day.baseWageNoteAr) {
    lines.push(day.baseWageNoteAr);
  }
  lines.push('');

  lines.push('🎯 التارجت');
  if (day.targetSales != null || day.targetAmount != null) {
    lines.push(`مبيعات: ${money(day.targetSales)}`);
    lines.push(`مستحق تارجت: ${money(day.targetAmount)}`);
  } else if (day.targetPersistence === 'not_generated') {
    lines.push('لم يُولَّد تارجت لليوم ده');
  } else {
    lines.push('—');
  }
  lines.push('');

  if (day.deductions > 0) {
    lines.push(`➖ خصم اليوم: ${money(day.deductions)}`);
  }
  if (day.advances > 0) {
    lines.push(`➖ سلفة اليوم: ${money(day.advances)}`);
  }
  lines.push(`📌 صافي اليوم: ${money(day.dayNet)}`);
  lines.push('');
  lines.push('━━━━━━━━━━━━');
  lines.push(`📒 رصيد حسابك حتى الآن: ${money(ledgerBalance)}`);
  lines.push('(أساسي + تارجت − سلف − خصومات − مصروف)');
  lines.push('');
  lines.push('لو في أي ملاحظة على اليوم، كلّم الإدارة 🙂');

  return lines.join('\n');
}

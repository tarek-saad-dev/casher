/**
 * Pure Arabic WhatsApp message composers for attendance check-in / check-out.
 */

import { formatTime12hAr } from '@/lib/reports/reportFormatters';
import { sqlTimeToHHmm } from '@/lib/timeUtils';

function timeLabel(time: string): string {
  return formatTime12hAr(time) ?? time.trim();
}

export function composeAttendanceCheckInWhatsAppMessage(time: string): string {
  return `تم تسجيل حضورك الساعة ${timeLabel(time)}`;
}

export function composeAttendanceCheckOutWhatsAppMessage(time: string): string {
  return `تم تسجيل انصرافك الساعة ${timeLabel(time)}`;
}

/** True when a new time is set and differs from the previously stored value. */
export function shouldNotifyAttendanceTimeChange(
  previous: unknown,
  next: string | null | undefined,
): boolean {
  const nextHhmm = sqlTimeToHHmm(next);
  if (!nextHhmm) return false;
  return sqlTimeToHHmm(previous) !== nextHhmm;
}

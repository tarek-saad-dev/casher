import { parseTimeToMinutes, sqlTimeToHHmm } from '@/lib/timeUtils';

/** Duration in minutes for a shift window; supports overnight (end <= start). */
export function calcShiftDurationMinutes(
  start: string | null | undefined,
  end: string | null | undefined,
): number | null {
  const startMin = parseTimeToMinutes(start);
  const endMin = parseTimeToMinutes(end);
  if (startMin === null || endMin === null) return null;

  let diff = endMin - startMin;
  if (diff <= 0) diff += 24 * 60;
  return diff;
}

export function isOvernightShift(
  start: string | null | undefined,
  end: string | null | undefined,
): boolean {
  const startMin = parseTimeToMinutes(start);
  const endMin = parseTimeToMinutes(end);
  if (startMin === null || endMin === null) return false;
  return endMin <= startMin;
}

export function formatTime12hAr(val: string | null | undefined): string | null {
  const hhmm = sqlTimeToHHmm(val);
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const isPm = h >= 12;
  const h12 = h % 12 || 12;
  const period = isPm ? 'م' : 'ص';
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export function formatScheduleRangeAr(
  start: string | null,
  end: string | null,
): string | null {
  if (!start || !end) return null;
  const startLabel = formatTime12hAr(start);
  const endLabel = formatTime12hAr(end);
  if (!startLabel || !endLabel) return null;
  const overnight = isOvernightShift(start, end);
  return `${startLabel} – ${endLabel}${overnight ? ' (+1)' : ''}`;
}

export function formatDurationAr(totalMinutes: number | null | undefined): string {
  if (totalMinutes == null || Number.isNaN(totalMinutes) || totalMinutes < 0) return '—';
  if (totalMinutes === 0) return '0';

  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;

  if (hours > 0 && mins > 0) return `${hours} س ${mins} د`;
  if (hours > 0) return `${hours} س`;
  return `${mins} دقيقة`;
}

export function formatCurrencyAr(value: number): string {
  return new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency: 'EGP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export const AR_DAY_NAMES = [
  'الأحد',
  'الاثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
] as const;

export function getArabicDayName(dateStr: string): string {
  const dow = new Date(`${dateStr}T12:00:00Z`).getDay();
  return AR_DAY_NAMES[dow] ?? '';
}

export function getArabicMonthLabel(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  return d.toLocaleDateString('ar-EG', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Cairo',
  });
}

export function sanitizeFilenamePart(value: string): string {
  return value
    .trim()
    .replace(/[^\w\u0600-\u06FF\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'employee';
}

export function getCairoGeneratedAtLabel(): string {
  return new Date().toLocaleString('ar-EG', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: 'long',
     day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

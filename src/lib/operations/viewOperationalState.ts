import type { BootstrapActiveBranch } from '@/modules/operations/domain/bootstrapTypes';

export function branchDisplayName(
  branch: Pick<BootstrapActiveBranch, 'shortName' | 'branchName' | 'branchCode'> | null | undefined,
): string {
  if (!branch) return 'الفرع';
  return branch.shortName || branch.branchName || branch.branchCode;
}

export function viewMatchesOperational(
  viewBranchId: number | null | undefined,
  operationalBranchId: number | null | undefined,
): boolean {
  if (viewBranchId == null || operationalBranchId == null) return false;
  return viewBranchId === operationalBranchId;
}

/** Compact Arabic elapsed duration, e.g. "3 س 18 د". */
export function formatShiftElapsed(
  startDate: string | null | undefined,
  startTime: string | null | undefined,
  now: Date = new Date(),
): string | null {
  const started = parseShiftStart(startDate, startTime);
  if (!started) return null;
  const ms = Math.max(0, now.getTime() - started.getTime());
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} د`;
  return `${hours} س ${minutes} د`;
}

/** Friendly clock time for shift start, e.g. "11:04". */
export function formatShiftStartTime(
  startDate: string | null | undefined,
  startTime: string | null | undefined,
): string | null {
  const started = parseShiftStart(startDate, startTime);
  if (!started) {
    const trimmed = startTime?.trim();
    return trimmed || null;
  }
  return started.toLocaleTimeString('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function parseShiftStart(
  startDate: string | null | undefined,
  startTime: string | null | undefined,
): Date | null {
  const datePart = (startDate || '').trim().slice(0, 10);
  const timeRaw = (startTime || '').trim();
  if (!datePart && !timeRaw) return null;

  if (timeRaw) {
    const ampm = timeRaw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (ampm && datePart) {
      let hour = Number(ampm[1]);
      const minute = Number(ampm[2]);
      const mer = ampm[3].toUpperCase();
      if (mer === 'PM' && hour < 12) hour += 12;
      if (mer === 'AM' && hour === 12) hour = 0;
      const d = new Date(`${datePart}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const h24 = timeRaw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (h24 && datePart) {
      const d = new Date(
        `${datePart}T${String(Number(h24[1])).padStart(2, '0')}:${h24[2]}:${h24[3] || '00'}`,
      );
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }

  if (datePart) {
    const d = new Date(`${datePart}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export type OperationalUiErrorCode =
  | 'NO_OPEN_DAY'
  | 'BUSINESS_DAY_RECONCILIATION_FAILED'
  | 'ALREADY_OPEN_SHIFT'
  | 'OPEN_SHIFTS'
  | 'STALE_DAY_RECONCILIATION_FAILED'
  | 'GENERIC';

/** Map domain / API errors into short staff-facing Arabic copy. */
export function mapOperationalError(
  err: unknown,
  fallback = 'حدث خطأ غير متوقع. حاول مرة أخرى.',
): string {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : '';
  const message =
    err instanceof Error
      ? err.message
      : err && typeof err === 'object' && 'message' in err
        ? String((err as { message?: unknown }).message || '')
        : typeof err === 'string'
          ? err
          : '';

  const upper = `${code} ${message}`.toUpperCase();
  if (
    upper.includes('NO_OPEN_DAY') ||
    message.includes('لا يوجد يوم') ||
    message.includes('يوم عمل')
  ) {
    return 'تعذر بدء الوردية لأن اليوم التشغيلي غير جاهز.';
  }
  if (
    upper.includes('BUSINESS_DAY_RECONCILIATION_FAILED') ||
    upper.includes('STALE_DAY_RECONCILIATION_FAILED') ||
    message.includes('تجهيز يوم')
  ) {
    return 'تعذر تجهيز يوم العمل الحالي. حاول مرة أخرى.';
  }
  if (upper.includes('ALREADY_OPEN_SHIFT') || message.includes('وردية مفتوحة بالفعل')) {
    return 'لديك وردية مفتوحة بالفعل.';
  }
  if (upper.includes('OPEN_SHIFTS') || message.includes('وردية مفتوحة')) {
    return 'لا يمكن إغلاق اليوم قبل إنهاء الورديات المفتوحة.';
  }
  if (message.includes('نقل الوردية') || message.includes('فرع معروض')) {
    return message;
  }
  // Never surface raw English/SQL to staff when we have a fallback.
  if (/[A-Za-z]{4,}/.test(message) && /SQL|constraint|ECONN|timeout|failed/i.test(message)) {
    return fallback;
  }
  return message || fallback;
}

export function classifyOperationalError(err: unknown): OperationalUiErrorCode {
  const text = mapOperationalError(err, '');
  if (text.includes('اليوم التشغيلي غير جاهز')) return 'NO_OPEN_DAY';
  if (text.includes('تجهيز يوم العمل')) return 'BUSINESS_DAY_RECONCILIATION_FAILED';
  if (text.includes('وردية مفتوحة بالفعل')) return 'ALREADY_OPEN_SHIFT';
  if (text.includes('إنهاء الورديات المفتوحة')) return 'OPEN_SHIFTS';
  return 'GENERIC';
}

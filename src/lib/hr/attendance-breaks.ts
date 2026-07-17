/**
 * Mid-shift interrupt / break intervals (وقت مستقطع) for hourly attendance.
 * Net worked hours = (CheckOut − CheckIn) − sum(break minutes).
 */

export interface AttendanceBreakInterval {
  ID?: number;
  LeaveAt: string;
  ReturnAt: string | null;
  Minutes?: number;
  Notes?: string | null;
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

export function normalizeTimeHHmm(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const m = String(value).trim().match(TIME_RE);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

/** Minutes from midnight; supports overnight span when end <= start (+1440). */
export function timeToMinutes(value: string | null | undefined): number | null {
  const t = normalizeTimeHHmm(value);
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if ([h, m].some((n) => Number.isNaN(n))) return null;
  return h * 60 + m;
}

/**
 * Duration in minutes between leave and return.
 * If return <= leave, treat as overnight (e.g. 23:00 → 01:00 = 120).
 * Open intervals (no return) contribute 0 until closed.
 */
export function breakIntervalMinutes(
  leaveAt: string | null | undefined,
  returnAt: string | null | undefined,
): number {
  const leave = timeToMinutes(leaveAt);
  const ret = timeToMinutes(returnAt);
  if (leave == null || ret == null) return 0;
  let end = ret;
  if (end <= leave) end += 1440;
  return end - leave;
}

export function sumBreakMinutes(breaks: AttendanceBreakInterval[] | null | undefined): number {
  if (!breaks?.length) return 0;
  return breaks.reduce((sum, b) => {
    const mins =
      b.Minutes != null && Number.isFinite(Number(b.Minutes))
        ? Math.max(0, Math.round(Number(b.Minutes)))
        : breakIntervalMinutes(b.LeaveAt, b.ReturnAt);
    return sum + mins;
  }, 0);
}

/** Gross span CheckIn→CheckOut in hours (overnight-aware). */
export function computeGrossHoursFromTimes(
  checkIn: string | null | undefined,
  checkOut: string | null | undefined,
): number | null {
  const start = timeToMinutes(checkIn);
  const endRaw = timeToMinutes(checkOut);
  if (start == null || endRaw == null) return null;
  let end = endRaw;
  if (end <= start) end += 1440;
  const hours = (end - start) / 60;
  return hours > 0 ? Math.round(hours * 100) / 100 : 0;
}

/** Net worked hours after subtracting break minutes. */
export function computeNetWorkedHours(
  checkIn: string | null | undefined,
  checkOut: string | null | undefined,
  breaks?: AttendanceBreakInterval[] | null,
  breakMinutesTotal?: number | null,
): number | null {
  const gross = computeGrossHoursFromTimes(checkIn, checkOut);
  if (gross == null) return null;
  const breakMins =
    breakMinutesTotal != null && Number.isFinite(Number(breakMinutesTotal))
      ? Math.max(0, Math.round(Number(breakMinutesTotal)))
      : sumBreakMinutes(breaks);
  const net = Math.max(0, gross - breakMins / 60);
  return Math.round(net * 100) / 100;
}

export interface NormalizedBreaksResult {
  breaks: AttendanceBreakInterval[];
  breakMinutesTotal: number;
  error: string | null;
}

/**
 * Validate and normalize incoming break payloads.
 * Drops empty rows; requires LeaveAt+ReturnAt for counted intervals.
 */
export function normalizeBreaksInput(
  raw: unknown,
): NormalizedBreaksResult {
  if (raw == null) {
    return { breaks: [], breakMinutesTotal: 0, error: null };
  }
  if (!Array.isArray(raw)) {
    return { breaks: [], breakMinutesTotal: 0, error: 'صيغة فترات المستقطع غير صحيحة' };
  }

  const breaks: AttendanceBreakInterval[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as Record<string, unknown> | null;
    if (!item || typeof item !== 'object') {
      return { breaks: [], breakMinutesTotal: 0, error: `فترة مستقطع رقم ${i + 1} غير صحيحة` };
    }
    const leaveAt = normalizeTimeHHmm(
      (item.LeaveAt ?? item.leaveAt) as string | null | undefined,
    );
    const returnAt = normalizeTimeHHmm(
      (item.ReturnAt ?? item.returnAt) as string | null | undefined,
    );
    // Skip fully empty draft rows
    if (!leaveAt && !returnAt) continue;
    if (!leaveAt) {
      return {
        breaks: [],
        breakMinutesTotal: 0,
        error: `وقت الخروج مطلوب لفترة المستقطع رقم ${i + 1}`,
      };
    }
    if (!returnAt) {
      return {
        breaks: [],
        breakMinutesTotal: 0,
        error: `وقت العودة مطلوب لفترة المستقطع رقم ${i + 1}`,
      };
    }
    if (leaveAt === returnAt) {
      return {
        breaks: [],
        breakMinutesTotal: 0,
        error: `وقت الخروج والعودة متطابقان في فترة ${i + 1}`,
      };
    }
    const minutes = breakIntervalMinutes(leaveAt, returnAt);
    const notesRaw = (item.Notes ?? item.notes) as string | null | undefined;
    breaks.push({
      LeaveAt: leaveAt,
      ReturnAt: returnAt,
      Minutes: minutes,
      Notes: notesRaw ? String(notesRaw).slice(0, 200) : null,
    });
  }

  return {
    breaks,
    breakMinutesTotal: sumBreakMinutes(breaks),
    error: null,
  };
}

export function formatBreakMinutesLabel(minutes: number): string {
  if (minutes <= 0) return '—';
  if (minutes < 60) return `${minutes} د`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}س ${m}د` : `${h}س`;
}

/**
 * Format break intervals for WhatsApp / UI:
 * "من 2:00 م إلى 2:30 م" — one line per period.
 */
export function formatBreakIntervalRangeAr(
  leaveAt: string | null | undefined,
  returnAt: string | null | undefined,
  formatTime: (t: string | null | undefined) => string | null,
): string | null {
  const leave = formatTime(leaveAt);
  if (!leave) return null;
  const ret = formatTime(returnAt);
  if (!ret) return `من ${leave} (بدون عودة)`;
  return `من ${leave} إلى ${ret}`;
}

export function formatBreakIntervalsLinesAr(
  breaks: AttendanceBreakInterval[] | null | undefined,
  formatTime: (t: string | null | undefined) => string | null,
): string[] {
  if (!breaks?.length) return [];
  const lines: string[] = [];
  for (const b of breaks) {
    const range = formatBreakIntervalRangeAr(b.LeaveAt, b.ReturnAt, formatTime);
    if (range) lines.push(range);
  }
  return lines;
}

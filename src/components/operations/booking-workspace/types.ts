import {
  getCairoCalendarDate,
  getOperationalDate,
  shiftCalendarDate,
} from '@/lib/businessDate';

export interface BookingService {
  ProID: number;
  ProName: string;
  SPrice: number;
  SPrice1?: number;
  DurationMinutes: number | null;
  CatName?: string | null;
  isDeleted?: number | boolean;
}

export interface BookingClient {
  ClientID: number;
  Name: string;
  Mobile?: string;
}

export interface AvailableSlot {
  time: string;
  endTime: string;
  label: string;
  empId: number;
  barberName: string;
  durationMinutes: number;
  dayOffset?: 0 | 1;
  startAt?: string;
  endAt?: string;
  available: boolean;
}

export interface GapNotice {
  gapStart: string;
  gapEnd: string;
  gapMinutes: number;
  requiredMinutes: number;
  message: string;
}

export interface BarberAlternative {
  empId: number;
  empName: string;
  time: string;
  endTime: string;
}

export interface BookingWorkspaceBarber {
  empId: number;
  empName: string;
  status?: 'working' | 'off' | 'day_off' | 'absent' | 'not_checked_in' | 'unknown';
  workStart?: string | null;
  workEnd?: string | null;
  nextAvailableAt?: string | null;
  statusReasonArabic?: string;
}

export type BookingMode = 'nearest' | 'specific';
export type BookingStep = 1 | 2 | 3 | 4 | 5;

export const BOOKING_STEPS: Array<{ id: BookingStep; label: string }> = [
  { id: 1, label: 'الحلاق' },
  { id: 2, label: 'الخدمات' },
  { id: 3, label: 'الموعد' },
  { id: 4, label: 'العميل' },
  { id: 5, label: 'المراجعة' },
];

export const GOLD = 'var(--primary)';
export const GOLD_BG = 'color-mix(in srgb, var(--primary) 10%, transparent)';
export const GOLD_BDR = 'color-mix(in srgb, var(--primary) 35%, transparent)';
export const SURFACE = 'var(--surface)';
export const BORDER = 'var(--border)';

/** @deprecated Prefer getOperationalToday — calendar date ignores overnight shifts. */
export function getCairoToday(): string {
  return getCairoCalendarDate();
}

/** Active operational day (before 04:00 Cairo → previous calendar date). */
export function getOperationalToday(now?: Date): string {
  return getOperationalDate({ now });
}

/** Next calendar day after the active operational day. */
export function getOperationalTomorrow(now?: Date): string {
  return shiftCalendarDate(getOperationalDate({ now }), 1);
}

/** @deprecated Prefer getOperationalTomorrow. */
export function getCairoTomorrow(): string {
  return getOperationalTomorrow();
}

/**
 * True when `dateStr` is before the current operational day.
 * The previous calendar date remains bookable while its overnight shift is still active.
 */
export function isBeforeOperationalDate(dateStr: string, now?: Date): boolean {
  return dateStr < getOperationalDate({ now });
}

/** @deprecated Prefer isBeforeOperationalDate. */
export function isPastCairoDate(dateStr: string, now?: Date): boolean {
  return isBeforeOperationalDate(dateStr, now);
}

/**
 * Clamp booking dates to the operational-day floor (no arbitrary historical dates).
 * Availability API remains the source of truth for slots / day-off.
 */
export function sanitizeDate(dateStr: string | undefined, now?: Date): string {
  const operational = getOperationalDate({ now });
  if (!dateStr || dateStr < operational) return operational;
  return dateStr;
}

export function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`;
}

function parseHhMm(timeStr: string): { h: number; m: number } | null {
  const match = String(timeStr).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return { h, m };
}

/** Format HH:MM (24h) as Arabic 12h with ص/م — `01:05` → `1:05 ص`, `13:05` → `1:05 م`. */
export function fmt(timeStr: string): string {
  const parsed = parseHhMm(timeStr);
  if (!parsed) return timeStr;
  const { h, m } = parsed;
  const suffix = h >= 12 ? 'م' : 'ص';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Format HH:MM (24h) as English 12h with AM/PM — `01:05` → `1:05 AM`, `13:05` → `1:05 PM`. */
export function fmtEn(timeStr: string): string {
  const parsed = parseHhMm(timeStr);
  if (!parsed) return timeStr;
  const { h, m } = parsed;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function cairoHhMmFromInstant(iso: string): string | null {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Africa/Cairo',
    });
  } catch {
    return null;
  }
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function cairoDateTimeMs(dateStr: string, hhmm: string): number {
  return new Date(`${dateStr}T${hhmm}:00+03:00`).getTime();
}

export function isSlotInsideRange(
  slot: AvailableSlot,
  rangeStart: string,
  rangeEnd: string,
  bookingDate: string,
): boolean {
  if (slot.startAt && slot.endAt) {
    const slotStart = new Date(slot.startAt).getTime();
    const slotEnd = new Date(slot.endAt).getTime();
    let rangeStartMs = cairoDateTimeMs(bookingDate, rangeStart);
    let rangeEndMs = cairoDateTimeMs(bookingDate, rangeEnd);
    if (rangeEndMs <= rangeStartMs) rangeEndMs += 24 * 60 * 60 * 1000;
    return slotStart >= rangeStartMs && slotEnd <= rangeEndMs;
  }
  const s = timeToMinutes(slot.time);
  const endMin = timeToMinutes(slot.endTime || slot.time);
  const rangeStartMin = timeToMinutes(rangeStart);
  const rangeEndMin = timeToMinutes(rangeEnd);
  const overnightSlot = (slot.dayOffset ?? 0) === 1 || endMin < s;
  const overnightRange = rangeEndMin <= rangeStartMin;
  if (overnightSlot || overnightRange) {
    const slotStartAbs = s + ((slot.dayOffset ?? 0) === 1 ? 24 * 60 : 0);
    const slotEndAbs = endMin + ((slot.dayOffset ?? 0) === 1 || endMin < s ? 24 * 60 : 0);
    const rangeEndAbs = overnightRange ? rangeEndMin + 24 * 60 : rangeEndMin;
    return slotStartAbs >= rangeStartMin && slotEndAbs <= rangeEndAbs;
  }
  return s >= rangeStartMin && endMin <= rangeEndMin;
}

export function hourGroupLabel(slot: AvailableSlot): string {
  const ref = slot.startAt ? new Date(slot.startAt) : null;
  if (ref && !Number.isNaN(ref.getTime())) {
    const hhmm = cairoHhMmFromInstant(ref.toISOString());
    if (hhmm) return fmt(hhmm).replace(/:\d{2}.*/, '');
  }
  return fmt(slot.time).replace(/:\d{2}.*/, '');
}

export function groupSlotsByHour(slots: AvailableSlot[]): Array<{ label: string; slots: AvailableSlot[] }> {
  const groups: Array<{ label: string; slots: AvailableSlot[] }> = [];
  const map = new Map<string, AvailableSlot[]>();
  for (const slot of slots) {
    const label = hourGroupLabel(slot);
    if (!map.has(label)) {
      const bucket: AvailableSlot[] = [];
      map.set(label, bucket);
      groups.push({ label, slots: bucket });
    }
    map.get(label)!.push(slot);
  }
  return groups;
}

export function slotDisplayLabel(slot: AvailableSlot): string {
  if (slot.label) return slot.label;
  if (slot.startAt && slot.endAt) {
    const startHh = cairoHhMmFromInstant(slot.startAt);
    const endHh = cairoHhMmFromInstant(slot.endAt);
    if (startHh && endHh) return `${fmt(startHh)} – ${fmt(endHh)}`;
  }
  return `${fmt(slot.time)} – ${fmt(slot.endTime)}`;
}

export function barberStatusLabel(status?: BookingWorkspaceBarber['status']): string {
  switch (status) {
    case 'working': return 'متاح';
    case 'off': return 'مشغول';
    case 'day_off': return 'إجازة';
    case 'absent': return 'غائب';
    case 'not_checked_in': return 'لم يسجل';
    default: return 'غير معروف';
  }
}

/** Format barber work window as Arabic 12h — `13:20`/`02:00` → `1:20 م – 2:00 ص`. */
export function formatBarberHours(
  workStart?: string | null,
  workEnd?: string | null,
): string | null {
  if (!workStart || !workEnd) return null;
  return `${fmt(workStart)} – ${fmt(workEnd)}`;
}

/** Map flow-board barber rows into booking workspace card props. */
export function mapFlowBoardBarbersForBooking(
  rows: Array<{
    empId: number;
    empName: string;
    status?: BookingWorkspaceBarber['status'];
    workStart?: string | null;
    workEnd?: string | null;
    nextAvailableAt?: string | null;
    statusReasonArabic?: string;
  }>,
): BookingWorkspaceBarber[] {
  return rows.map((b) => ({
    empId: b.empId,
    empName: b.empName,
    status: b.status,
    workStart: b.workStart ?? null,
    workEnd: b.workEnd ?? null,
    nextAvailableAt: b.nextAvailableAt ?? null,
    statusReasonArabic: b.statusReasonArabic,
  }));
}

/**
 * When bookingDate diverges from the ops board date, board hours/status are stale.
 * Strip schedule metadata so cards do not show the wrong day's window.
 */
export function stripStaleBarberDayMeta(
  barbers: BookingWorkspaceBarber[],
): BookingWorkspaceBarber[] {
  return barbers.map((b) => ({
    ...b,
    workStart: null,
    workEnd: null,
    nextAvailableAt: null,
    status: 'unknown' as const,
    statusReasonArabic: undefined,
  }));
}

/**
 * Format next-available instant or HH:MM for display.
 * Overnight early-morning hours (01:05) always render as ص / AM, never PM.
 */
export function formatNextAvailable(isoOrTime: string | null | undefined): string | null {
  if (!isoOrTime) return null;
  const asHhMm = parseHhMm(isoOrTime);
  if (asHhMm && !isoOrTime.includes('T') && isoOrTime.length <= 8) {
    return fmt(isoOrTime);
  }
  const hhmm = cairoHhMmFromInstant(isoOrTime) ?? (asHhMm ? isoOrTime.slice(0, 5) : null);
  if (!hhmm) return null;
  return fmt(hhmm);
}

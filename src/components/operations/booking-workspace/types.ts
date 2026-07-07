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

export function getCairoToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

export function getCairoTomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

export function isPastCairoDate(dateStr: string): boolean {
  return dateStr < getCairoToday();
}

export function sanitizeDate(dateStr: string | undefined): string {
  const today = getCairoToday();
  if (!dateStr || dateStr < today) return today;
  return dateStr;
}

export function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`;
}

export function fmt(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const suffix = h >= 12 ? 'م' : 'ص';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
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
  if (ref) {
    return ref.toLocaleTimeString('ar-EG', {
      hour: 'numeric',
      hour12: true,
      timeZone: 'Africa/Cairo',
    });
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
    const start = fmt(new Date(slot.startAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Cairo' }));
    const end = fmt(new Date(slot.endAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Cairo' }));
    return `${start} – ${end}`;
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

export function formatNextAvailable(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString('ar-EG', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Africa/Cairo',
    });
  } catch {
    return null;
  }
}

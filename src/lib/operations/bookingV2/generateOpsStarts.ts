/**
 * Local start generation from FreeRanges — no availability rule logic.
 * Shared contract: generateStartsFromFree (B9).
 */

import { generateStartsFromFree } from '@/lib/booking/v2Frontend';
import type { V2PublicAvailabilityDayDto } from '@/lib/booking/v2Frontend/publicSafeDtos';
import type { V2PublicBookingSettingsDto } from '@/lib/booking/v2Frontend/publicSafeDtos';
import type { GeneratedStart } from '@/lib/operations/bookingV2/types';

function endTimeFromStart(time: string, durationMinutes: number, dayOffset: 0 | 1): {
  endTime: string;
  endDayOffset: 0 | 1 | 2;
} {
  const [h, m] = time.split(':').map(Number);
  const startMin = (dayOffset * 1440) + h * 60 + m;
  const endMin = startMin + durationMinutes;
  const endDayOffset = Math.floor(endMin / 1440) as 0 | 1 | 2;
  const clock = ((endMin % 1440) + 1440) % 1440;
  const eh = Math.floor(clock / 60);
  const em = clock % 60;
  return {
    endTime: `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`,
    endDayOffset,
  };
}

function formatLabel(startTime: string, endTime: string): string {
  const fmt = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    const suffix = h >= 12 ? 'م' : 'ص';
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
  };
  return `${fmt(startTime)} – ${fmt(endTime)}`;
}

export function generateStartsForDay(args: {
  day: V2PublicAvailabilityDayDto;
  durationMinutes: number;
  settings?: V2PublicBookingSettingsDto | null;
  barberName: string;
  nowMs?: number;
}): GeneratedStart[] {
  const duration = Math.max(1, Math.floor(args.durationMinutes));
  const slotInterval = args.settings?.slotIntervalMinutes ?? 15;
  const minNotice = args.settings?.minNoticeMinutes ?? 0;
  const { starts } = generateStartsFromFree({
    freeRanges: args.day.freeRanges,
    freeMaskB64: args.day.freeMaskB64,
    durationMinutes: duration,
    slotIntervalMinutes: slotInterval,
    businessDate: args.day.businessDate,
    nowMs: args.nowMs ?? Date.now(),
    minNoticeMinutes: minNotice,
  });

  return starts.map((s) => {
    const { endTime } = endTimeFromStart(s.time, duration, s.dayOffset);
    const endAtMs = s.startAtMs + duration * 60_000;
    return {
      ...s,
      employeeId: args.day.employeeId,
      branchId: args.day.branchId,
      branchCode: args.day.branchCode,
      businessDate: args.day.businessDate,
      durationMinutes: duration,
      barberName: args.barberName,
      endTime,
      label: formatLabel(s.time, endTime),
      startAt: new Date(s.startAtMs).toISOString(),
      endAt: new Date(endAtMs).toISOString(),
    };
  });
}

export function filterDaysForSelection(args: {
  days: V2PublicAvailabilityDayDto[];
  businessDate: string;
  employeeId?: number | null;
  branchCode?: string | null;
}): V2PublicAvailabilityDayDto[] {
  return args.days.filter((d) => {
    if (d.businessDate !== args.businessDate) return false;
    if (args.employeeId != null && d.employeeId !== args.employeeId) return false;
    if (args.branchCode) {
      if (d.branchCode.toUpperCase() !== args.branchCode.toUpperCase()) return false;
    }
    return true;
  });
}

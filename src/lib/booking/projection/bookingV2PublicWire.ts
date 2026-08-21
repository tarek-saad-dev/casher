/**
 * Pure V2 → public wire mappers (no DB / server-only).
 */

import type {
  PublicAvailableDayWire,
  PublicAvailableDaysResponse,
  PublicAvailableSlotsResponse,
  PublicAvailabilityMode,
  PublicSlotWire,
} from '@/lib/booking/publicBookingAvailability';
import type { V2EmployeeDayAvailability } from '@/lib/booking/projection/resolveBookingAvailabilityV2';

const CONTRACT = 'v7';

export function mapV2DaysToPublicSlots(args: {
  days: V2EmployeeDayAvailability[];
  businessDate: string;
  durationMinutes: number;
  namesByEmpId: Map<number, string>;
  empId: number | null;
}): PublicSlotWire[] {
  const map = new Map<string, PublicSlotWire>();
  for (const day of args.days) {
    if (day.businessDate !== args.businessDate) continue;
    if (args.empId != null && day.employeeId !== args.empId) continue;
    const nameAr = args.namesByEmpId.get(day.employeeId);
    if (!nameAr) continue;
    for (const s of day.availableStarts) {
      const key = `${s.dayOffset}|${s.time}`;
      let slot = map.get(key);
      if (!slot) {
        const endAtMs = s.startAtMs + args.durationMinutes * 60_000;
        slot = {
          time: s.time,
          dayOffset: s.dayOffset,
          startDateTime: new Date(s.startAtMs).toISOString(),
          endDateTime: new Date(endAtMs).toISOString(),
          barbers: [],
        };
        map.set(key, slot);
      }
      if (!slot.barbers.some((b) => b.empId === day.employeeId)) {
        slot.barbers.push({ empId: day.employeeId, nameAr });
      }
    }
  }
  return [...map.values()].sort((a, b) =>
    a.dayOffset !== b.dayOffset
      ? a.dayOffset - b.dayOffset
      : a.time.localeCompare(b.time),
  );
}

export function buildPublicSlotsResponseFromV2(args: {
  branchCode: string;
  branchName: string;
  selected: {
    serviceIds: number[];
    totalDurationMinutes: number;
    totalPrice: number;
  };
  date: string;
  empId: number | null;
  slots: PublicSlotWire[];
  eligibleBarberCount: number;
}): PublicAvailableSlotsResponse {
  const mode: PublicAvailabilityMode = args.empId
    ? 'specific_barber'
    : 'any_barber';
  return {
    ok: true,
    branch: { branchCode: args.branchCode, branchName: args.branchName },
    date: args.date,
    mode,
    services: {
      serviceIds: args.selected.serviceIds,
      totalDurationMinutes: args.selected.totalDurationMinutes,
      totalPrice: args.selected.totalPrice,
    },
    slots: args.slots,
    meta: {
      slotCount: args.slots.length,
      ...(args.empId ? {} : { eligibleBarberCount: args.eligibleBarberCount }),
      contractVersion: CONTRACT,
      generatedAt: new Date().toISOString(),
    },
  };
}

export function buildPublicDaysResponseFromV2(args: {
  branchCode: string;
  branchName: string;
  selected: {
    serviceIds: number[];
    totalDurationMinutes: number;
  };
  empId: number | null;
  days: PublicAvailableDayWire[];
}): PublicAvailableDaysResponse {
  const mode: PublicAvailabilityMode = args.empId
    ? 'specific_barber'
    : 'any_barber';
  return {
    ok: true,
    branch: { branchCode: args.branchCode, branchName: args.branchName },
    selection: {
      empId: args.empId,
      serviceIds: args.selected.serviceIds,
      totalDurationMinutes: args.selected.totalDurationMinutes,
      mode,
    },
    days: args.days,
    meta: {
      dayCount: args.days.length,
      generatedAt: new Date().toISOString(),
      contractVersion: CONTRACT,
    },
  };
}

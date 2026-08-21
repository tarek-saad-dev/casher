/**
 * Booking V2 B7B — DB-backed public read adapters (map FreeMask → public contracts).
 */

import 'server-only';
import type {
  PublicAvailableDayWire,
  PublicDayStatus,
  PublicSlotWire,
} from '@/lib/booking/publicBookingAvailability';
import type { PublicBookingBranchContext } from '@/lib/booking/publicBookingBranchContext';
import type { ResolvedSelectedBookingServices } from '@/lib/booking/bookingServiceDuration';
import type { V2EmployeeDayAvailability } from '@/lib/booking/projection/resolveBookingAvailabilityV2';
import {
  buildPublicDaysResponseFromV2,
  buildPublicSlotsResponseFromV2,
  mapV2DaysToPublicSlots,
} from '@/lib/booking/projection/bookingV2PublicWire';
import { listBookableEmployeeIdsForBranch } from '@/lib/branch/bookingQueueOwnership';
import { getPool, sql } from '@/lib/db';
import { isEmployeeHiddenFromPublicBooking } from '@/lib/hr/testEmployeePolicy';
import { shiftCalendarDate } from '@/lib/businessDate';
import { isOutsideBookingHorizon } from '@/lib/booking/publicBookingBarberPolicy';

export {
  mapV2DaysToPublicSlots,
  buildPublicSlotsResponseFromV2,
  buildPublicDaysResponseFromV2,
} from '@/lib/booking/projection/bookingV2PublicWire';

async function loadEmpNames(empIds: number[]): Promise<Map<number, string>> {
  const ids = [...new Set(empIds.filter((id) => Number.isInteger(id) && id > 0))];
  const out = new Map<number, string>();
  if (!ids.length) return out;
  const db = await getPool();
  const req = db.request();
  ids.forEach((id, i) => req.input(`e${i}`, sql.Int, id));
  const r = await req.query(`
    SELECT EmpID, EmpName, ISNULL(isActive,1) AS isActive
    FROM dbo.TblEmp
    WHERE EmpID IN (${ids.map((_, i) => `@e${i}`).join(',')})
  `);
  for (const row of r.recordset as Array<Record<string, unknown>>) {
    if (!(row.isActive === true || row.isActive === 1)) continue;
    const name = String(row.EmpName ?? '');
    if (isEmployeeHiddenFromPublicBooking(name)) continue;
    out.set(Number(row.EmpID), name);
  }
  return out;
}

export async function resolveV2PublicSlots(args: {
  branchCtx: PublicBookingBranchContext;
  selected: ResolvedSelectedBookingServices;
  date: string;
  empId: number | null;
  minNoticeMinutes: number;
  nowMs?: number;
}): Promise<{
  slots: PublicSlotWire[];
  eligibleBarberCount: number;
  queryCount: number;
  dbMs: number;
  composeMs: number;
  totalMs: number;
  employeeIds: number[];
}> {
  const { resolveBookingAvailabilityV2 } = await import(
    '@/lib/booking/projection/resolveBookingAvailabilityV2Live'
  );

  let employeeIds: number[];
  if (args.empId != null) {
    employeeIds = [args.empId];
  } else {
    employeeIds = await listBookableEmployeeIdsForBranch(
      args.branchCtx.branchId,
      args.date,
      { publicOnly: true },
    );
  }

  if (!employeeIds.length) {
    return {
      slots: [],
      eligibleBarberCount: 0,
      queryCount: 0,
      dbMs: 0,
      composeMs: 0,
      totalMs: 0,
      employeeIds: [],
    };
  }

  const v2 = await resolveBookingAvailabilityV2({
    employeeIds,
    branchIds: [args.branchCtx.branchId],
    businessDateRange: { from: args.date, to: args.date },
    durationMinutes: args.selected.totalDurationMinutes,
    slotIntervalMinutes: 15,
    source: 'public',
    nowMs: args.nowMs ?? Date.now(),
    minNoticeMinutes: args.minNoticeMinutes,
  });

  const names = await loadEmpNames(employeeIds);
  const slots = mapV2DaysToPublicSlots({
    days: v2.days,
    businessDate: args.date,
    durationMinutes: args.selected.totalDurationMinutes,
    namesByEmpId: names,
    empId: args.empId,
  });

  return {
    slots,
    eligibleBarberCount: employeeIds.length,
    queryCount: v2.queryCount,
    dbMs: v2.dbMs,
    composeMs: v2.composeMs,
    totalMs: v2.totalMs,
    employeeIds,
  };
}

export async function resolveV2PublicAvailableDays(args: {
  branchCtx: PublicBookingBranchContext;
  selected: ResolvedSelectedBookingServices;
  empId: number | null;
  from: string;
  to: string;
  horizonEnd: string;
  minNoticeMinutes: number;
  nowMs?: number;
}): Promise<{
  days: PublicAvailableDayWire[];
  queryCount: number;
  dbMs: number;
  composeMs: number;
  totalMs: number;
  employeeIds: number[];
}> {
  const { resolveBookingAvailabilityV2 } = await import(
    '@/lib/booking/projection/resolveBookingAvailabilityV2Live'
  );

  const dateRange: string[] = [];
  let cur = args.from;
  while (cur <= args.to) {
    dateRange.push(cur);
    cur = shiftCalendarDate(cur, 1);
  }

  let employeeIds: number[];
  if (args.empId != null) {
    employeeIds = [args.empId];
  } else {
    const [a, b] = await Promise.all([
      listBookableEmployeeIdsForBranch(args.branchCtx.branchId, args.from, {
        publicOnly: true,
      }),
      args.from === args.to
        ? Promise.resolve([] as number[])
        : listBookableEmployeeIdsForBranch(args.branchCtx.branchId, args.to, {
            publicOnly: true,
          }),
    ]);
    employeeIds = [...new Set([...a, ...b])];
  }

  const probeDates = dateRange.filter(
    (d) => !isOutsideBookingHorizon(d, args.horizonEnd),
  );

  let v2Days: V2EmployeeDayAvailability[] = [];
  let queryCount = 0;
  let dbMs = 0;
  let composeMs = 0;
  let totalMs = 0;

  if (employeeIds.length && probeDates.length) {
    const v2 = await resolveBookingAvailabilityV2({
      employeeIds,
      branchIds: [args.branchCtx.branchId],
      businessDateRange: {
        from: probeDates[0]!,
        to: probeDates[probeDates.length - 1]!,
      },
      durationMinutes: args.selected.totalDurationMinutes,
      slotIntervalMinutes: 15,
      source: 'public',
      nowMs: args.nowMs ?? Date.now(),
      minNoticeMinutes: args.minNoticeMinutes,
    });
    v2Days = v2.days;
    queryCount = v2.queryCount;
    dbMs = v2.dbMs;
    composeMs = v2.composeMs;
    totalMs = v2.totalMs;
  }

  const byDate = new Map<
    string,
    {
      available: boolean;
      first: { time: string; dayOffset: 0 | 1 } | null;
      empSet: Set<number>;
    }
  >();
  for (const d of probeDates) {
    byDate.set(d, { available: false, first: null, empSet: new Set() });
  }
  for (const day of v2Days) {
    const cell = byDate.get(day.businessDate);
    if (!cell) continue;
    if (!day.availableStarts.length) continue;
    cell.available = true;
    cell.empSet.add(day.employeeId);
    const first = day.availableStarts[0]!;
    if (
      !cell.first ||
      first.dayOffset < cell.first.dayOffset ||
      (first.dayOffset === cell.first.dayOffset && first.time < cell.first.time)
    ) {
      cell.first = { time: first.time, dayOffset: first.dayOffset };
    }
  }

  const days: PublicAvailableDayWire[] = dateRange.map((date) => {
    if (isOutsideBookingHorizon(date, args.horizonEnd)) {
      return {
        date,
        status: 'outside_booking_horizon' as const,
        isAvailable: false,
        availableSlotCount: 0,
        firstAvailableTime: null,
        firstAvailableDayOffset: null,
      };
    }
    if (!employeeIds.length) {
      return {
        date,
        status: (args.empId ? 'barber_day_off' : 'no_eligible_barber') as PublicDayStatus,
        isAvailable: false,
        availableSlotCount: 0,
        firstAvailableTime: null,
        firstAvailableDayOffset: null,
        ...(args.empId ? {} : { eligibleBarberCount: 0, availableBarberCount: 0 }),
      };
    }
    const cell = byDate.get(date)!;
    if (args.empId && !cell.available) {
      const hadAnyEmpDay = v2Days.some(
        (d) => d.businessDate === date && d.employeeId === args.empId,
      );
      return {
        date,
        status: (hadAnyEmpDay ? 'fully_booked' : 'barber_day_off') as PublicDayStatus,
        isAvailable: false,
        availableSlotCount: 0,
        firstAvailableTime: null,
        firstAvailableDayOffset: null,
      };
    }
    return {
      date,
      status: (cell.available ? 'available' : 'fully_booked') as PublicDayStatus,
      isAvailable: cell.available,
      availableSlotCount: cell.available ? 1 : 0,
      firstAvailableTime: cell.first?.time ?? null,
      firstAvailableDayOffset: cell.first?.dayOffset ?? null,
      ...(args.empId
        ? {}
        : {
            eligibleBarberCount: employeeIds.length,
            availableBarberCount: cell.empSet.size,
          }),
    };
  });

  return {
    days,
    queryCount,
    dbMs,
    composeMs,
    totalMs,
    employeeIds,
  };
}

/** Convenience wrappers matching branchCtx shape used by publicBookingAvailability. */
export function buildSlotsResponseForBranch(args: {
  branchCtx: PublicBookingBranchContext;
  selected: ResolvedSelectedBookingServices;
  date: string;
  empId: number | null;
  slots: PublicSlotWire[];
  eligibleBarberCount: number;
}) {
  return buildPublicSlotsResponseFromV2({
    branchCode: args.branchCtx.branchCode,
    branchName: args.branchCtx.branchName,
    selected: args.selected,
    date: args.date,
    empId: args.empId,
    slots: args.slots,
    eligibleBarberCount: args.eligibleBarberCount,
  });
}

export function buildDaysResponseForBranch(args: {
  branchCtx: PublicBookingBranchContext;
  selected: ResolvedSelectedBookingServices;
  empId: number | null;
  days: PublicAvailableDayWire[];
}) {
  return buildPublicDaysResponseFromV2({
    branchCode: args.branchCtx.branchCode,
    branchName: args.branchCtx.branchName,
    selected: args.selected,
    empId: args.empId,
    days: args.days,
  });
}

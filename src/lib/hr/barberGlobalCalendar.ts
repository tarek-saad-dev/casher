/**
 * Phase 1Q — global barber calendar / location helpers for public + admin preview.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { resolveEmployeeGlobalSchedule } from '@/lib/hr/employeeBranchScheduleResolver';
import { canBranchAppearInPublicBooking } from '@/lib/branch/publicBranchVisibility';
import { listAvailableBookingSlots } from '@/lib/bookingAvailabilityEngine';
import { getBranchById } from '@/lib/branch/repository';

export type BarberCalendarDayStatus =
  | 'available'
  | 'fully_booked'
  | 'day_off'
  | 'global_leave'
  | 'branch_closed'
  | 'not_assigned'
  | 'service_not_available'
  | 'outside_booking_horizon'
  | 'presence_only';

function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d.getTime() <= end.getTime()) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export async function buildBarberCalendar(args: {
  empId: number;
  from: string;
  to: string;
  serviceIds?: number[];
  branchCode?: string | null;
  publicOnly: boolean;
}): Promise<{
  barber: { empId: number; name: string };
  from: string;
  to: string;
  presenceOnly: boolean;
  days: Array<{
    date: string;
    status: BarberCalendarDayStatus;
    isPresent: boolean;
    isBookable: boolean;
    branches: Array<{
      branchCode: string;
      branchName: string;
      startTime: string | null;
      endTime: string | null;
      nextAvailableTime: string | null;
      availableSlotCount: number;
    }>;
  }>;
}> {
  const db = await getPool();
  const emp = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .query(`SELECT EmpID, EmpName FROM dbo.TblEmp WHERE EmpID = @empId`);
  if (!emp.recordset[0]) {
    throw new Error('EMP_NOT_FOUND');
  }

  let branchFilterId: number | null = null;
  if (args.branchCode) {
    const b = await db
      .request()
      .input('code', sql.NVarChar(30), args.branchCode)
      .query(`SELECT BranchID FROM dbo.TblBranch WHERE BranchCode = @code`);
    branchFilterId = b.recordset[0] ? Number(b.recordset[0].BranchID) : null;
  }

  const presenceOnly = !args.serviceIds?.length;
  const days = [];

  for (const date of eachDate(args.from, args.to)) {
    const global = await resolveEmployeeGlobalSchedule({
      empId: args.empId,
      workDate: date,
      allowedBranchIds: branchFilterId != null ? [branchFilterId] : undefined,
      publicOnly: args.publicOnly,
    });

    if (global.isGlobalDayOff || global.branches.length === 0) {
      days.push({
        date,
        status: 'day_off' as const,
        isPresent: false,
        isBookable: false,
        branches: [],
      });
      continue;
    }

    const branchEntries = [];
    let anySlots = 0;
    for (const br of global.branches) {
      if (args.publicOnly && !(await canBranchAppearInPublicBooking(br.branchId))) continue;

      let availableSlotCount = 0;
      let nextAvailableTime: string | null = null;
      if (!presenceOnly && args.serviceIds?.length) {
        try {
          const slots = await listAvailableBookingSlots({
            date,
            serviceIds: args.serviceIds,
            mode: 'specific',
            empId: args.empId,
            branchId: br.branchId,
            source: args.publicOnly ? 'public' : 'admin',
          });
          const available = slots.slots.filter((s) => s.available);
          availableSlotCount = available.length;
          nextAvailableTime = available[0]?.time ?? null;
          anySlots += availableSlotCount;
        } catch {
          availableSlotCount = 0;
        }
      }

      branchEntries.push({
        branchCode: br.branchCode,
        branchName: br.branchName,
        startTime: br.startTime,
        endTime: br.endTime,
        nextAvailableTime,
        availableSlotCount,
      });
    }

    let status: BarberCalendarDayStatus = 'available';
    let isBookable = true;
    if (presenceOnly) {
      status = 'presence_only';
      isBookable = false;
    } else if (anySlots === 0) {
      status = 'fully_booked';
      isBookable = false;
    }

    days.push({
      date,
      status,
      isPresent: true,
      isBookable,
      branches: branchEntries,
    });
  }

  return {
    barber: {
      empId: args.empId,
      name: String(emp.recordset[0].EmpName),
    },
    from: args.from,
    to: args.to,
    presenceOnly,
    days,
  };
}

export async function resolveBarberLocationForDate(args: {
  empId: number;
  date: string;
  publicOnly: boolean;
}): Promise<{
  date: string;
  isWorking: boolean;
  reason?: string;
  branch: {
    branchCode: string;
    branchName: string;
    address: string | null;
    phone: string | null;
  } | null;
}> {
  const global = await resolveEmployeeGlobalSchedule({
    empId: args.empId,
    workDate: args.date,
    publicOnly: args.publicOnly,
  });
  if (!global.isGloballyWorking || !global.branches[0]) {
    return {
      date: args.date,
      isWorking: false,
      reason: 'day_off',
      branch: null,
    };
  }
  const br = global.branches[0];
  const full = await getBranchById(br.branchId);
  return {
    date: args.date,
    isWorking: true,
    branch: {
      branchCode: br.branchCode,
      branchName: br.branchName,
      address: full?.address ?? null,
      phone: full?.phone ?? null,
    },
  };
}

/** Unique global public barbers (one row per EmpID). */
export async function listGlobalPublicBarbers(args?: {
  date?: string;
  serviceIds?: number[];
}): Promise<
  Array<{
    empId: number;
    name: string;
    branches: Array<{ branchCode: string; branchName: string }>;
  }>
> {
  const db = await getPool();
  const date = args?.date ?? new Date().toISOString().slice(0, 10);

  // Candidates: active barbers with any active assignment on a potentially public branch
  const rows = await db.request().input('day', sql.Date, date).query(`
    SELECT DISTINCT e.EmpID, e.EmpName, b.BranchID, b.BranchCode, b.BranchName
    FROM dbo.TblEmp e
    INNER JOIN dbo.TblEmpBranchAssignment a ON a.EmpID = e.EmpID
    INNER JOIN dbo.TblBranch b ON b.BranchID = a.BranchID
    WHERE ISNULL(e.isActive, 1) = 1
      AND e.Job IN (N'حلاق', N'مساعد', N'Barber', N'barber')
      AND a.IsActive = 1 AND a.CanReceiveBookings = 1
      AND a.EffectiveFrom <= @day
      AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= @day)
    ORDER BY e.EmpName, b.BranchCode
  `);

  const byEmp = new Map<
    number,
    { empId: number; name: string; branches: Array<{ branchCode: string; branchName: string }> }
  >();

  for (const row of rows.recordset) {
    const branchId = Number(row.BranchID);
    if (!(await canBranchAppearInPublicBooking(branchId))) continue;

    const empId = Number(row.EmpID);
    let entry = byEmp.get(empId);
    if (!entry) {
      entry = { empId, name: String(row.EmpName), branches: [] };
      byEmp.set(empId, entry);
    }
    if (!entry.branches.some((b) => b.branchCode === String(row.BranchCode))) {
      entry.branches.push({
        branchCode: String(row.BranchCode),
        branchName: String(row.BranchName),
      });
    }
  }

  return [...byEmp.values()];
}

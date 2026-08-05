/**
 * Suggest alternative slots for affected bookings via canonical engines.
 * Never compute availability in the UI.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { validateBookingMove } from '@/lib/bookingRescheduleCore';
import { getPublicAvailableSlots } from '@/lib/booking/publicBookingAvailability';
import { getBranchById } from '@/lib/branch/repository';

export type AffectedBookingAlternative = {
  rank: 1 | 2 | 3 | 4;
  kind:
    | 'same_employee_nearest'
    | 'other_employee_same_time'
    | 'other_employee_nearest'
    | 'other_branch';
  empId: number;
  empName: string | null;
  branchId: number;
  branchCode: string;
  businessDate: string;
  time: string;
  dayOffset: 0 | 1;
  startAtIso: string;
  labelAr: string;
};

function toIsoCairo(date: string, time: string, dayOffset: 0 | 1): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d, hh - 3, mm, 0));
  if (dayOffset === 1) base.setUTCDate(base.getUTCDate() + 1);
  return base.toISOString();
}

export async function suggestAffectedBookingAlternatives(args: {
  bookingId: number;
  allowOtherBranch?: boolean;
}): Promise<AffectedBookingAlternative[]> {
  const db = await getPool();
  const bk = await db
    .request()
    .input('id', sql.Int, args.bookingId)
    .query(`
      SELECT b.BookingID, b.AssignedEmpID, b.BranchID,
        CONVERT(varchar(10), b.BookingDate, 23) AS BookingDate,
        CONVERT(varchar(5), b.StartTime, 108) AS StartTime,
        e.EmpName, br.BranchCode
      FROM dbo.Bookings b
      LEFT JOIN dbo.TblEmp e ON e.EmpID = b.AssignedEmpID
      LEFT JOIN dbo.TblBranch br ON br.BranchID = b.BranchID
      WHERE b.BookingID = @id
    `);
  const row = bk.recordset[0] as Record<string, unknown> | undefined;
  if (!row) return [];

  const empId = Number(row.AssignedEmpID);
  const branchId = Number(row.BranchID);
  const branchCode = String(row.BranchCode ?? '');
  const businessDate = String(row.BookingDate).slice(0, 10);
  const originalTime = String(row.StartTime ?? '').slice(0, 5);
  const empName = row.EmpName != null ? String(row.EmpName) : null;

  const svc = await db
    .request()
    .input('id', sql.Int, args.bookingId)
    .query(`SELECT ProID FROM dbo.BookingServices WHERE BookingID=@id`);
  const serviceIds = svc.recordset
    .map((s: { ProID: number }) => Number(s.ProID))
    .filter((n) => n > 0);
  if (!serviceIds.length || !branchCode) return [];

  const out: AffectedBookingAlternative[] = [];

  // 1) Same employee nearest
  try {
    const same = await getPublicAvailableSlots({
      branchCode,
      date: businessDate,
      serviceIds,
      empId,
    });
    const slot = same.slots.find((s) => s.time >= originalTime) ?? same.slots[0];
    if (slot) {
      const startAtIso = toIsoCairo(businessDate, slot.time, (slot.dayOffset ?? 0) as 0 | 1);
      const v = await validateBookingMove({
        bookingId: args.bookingId,
        newStartAt: startAtIso,
        operationalDate: businessDate,
        targetEmpId: empId,
      });
      if (v.valid) {
        out.push({
          rank: 1,
          kind: 'same_employee_nearest',
          empId,
          empName,
          branchId,
          branchCode,
          businessDate,
          time: slot.time,
          dayOffset: (slot.dayOffset ?? 0) as 0 | 1,
          startAtIso,
          labelAr: `نفس الموظف — أقرب وقت ${slot.time}`,
        });
      }
    }
  } catch {
    /* continue */
  }

  // 2) Other employee same time
  try {
    const any = await getPublicAvailableSlots({
      branchCode,
      date: businessDate,
      serviceIds,
    });
    const sameTime = any.slots.find((s) => s.time === originalTime);
    const other = sameTime?.barbers?.find((b) => Number(b.empId) !== empId);
    if (sameTime && other) {
      const startAtIso = toIsoCairo(
        businessDate,
        sameTime.time,
        (sameTime.dayOffset ?? 0) as 0 | 1,
      );
      const v = await validateBookingMove({
        bookingId: args.bookingId,
        newStartAt: startAtIso,
        operationalDate: businessDate,
        targetEmpId: Number(other.empId),
      });
      if (v.valid) {
        out.push({
          rank: 2,
          kind: 'other_employee_same_time',
          empId: Number(other.empId),
          empName: other.nameAr ?? null,
          branchId,
          branchCode,
          businessDate,
          time: sameTime.time,
          dayOffset: (sameTime.dayOffset ?? 0) as 0 | 1,
          startAtIso,
          labelAr: `موظف آخر في نفس الوقت — ${other.nameAr ?? other.empId}`,
        });
      }
    }

    // 3) Other employee nearest
    for (const slot of any.slots) {
      const cand = slot.barbers?.find((b) => Number(b.empId) !== empId);
      if (!cand) continue;
      if (out.some((o) => o.rank === 3)) break;
      const startAtIso = toIsoCairo(businessDate, slot.time, (slot.dayOffset ?? 0) as 0 | 1);
      const v = await validateBookingMove({
        bookingId: args.bookingId,
        newStartAt: startAtIso,
        operationalDate: businessDate,
        targetEmpId: Number(cand.empId),
      });
      if (!v.valid) continue;
      out.push({
        rank: 3,
        kind: 'other_employee_nearest',
        empId: Number(cand.empId),
        empName: cand.nameAr ?? null,
        branchId,
        branchCode,
        businessDate,
        time: slot.time,
        dayOffset: (slot.dayOffset ?? 0) as 0 | 1,
        startAtIso,
        labelAr: `موظف آخر — أقرب وقت ${slot.time}`,
      });
      break;
    }
  } catch {
    /* continue */
  }

  // 4) Other public branch (explicit only)
  if (args.allowOtherBranch) {
    try {
      const { listPublicDiscoverableBranches } = await import(
        '@/lib/booking/publicBookingBranchContext'
      );
      const pubs = await listPublicDiscoverableBranches();
      for (const br of pubs) {
        if (br.branchId === branchId) continue;
        const slots = await getPublicAvailableSlots({
          branchCode: br.branchCode,
          date: businessDate,
          serviceIds,
        });
        const slot = slots.slots[0];
        const barber = slot?.barbers?.[0];
        if (!slot || !barber) continue;
        // Cross-branch move is not supported by rescheduleBookingMove (same booking BranchID).
        // Surface as informational suggestion only — rank 4, not auto-applicable.
        out.push({
          rank: 4,
          kind: 'other_branch',
          empId: Number(barber.empId),
          empName: barber.nameAr ?? null,
          branchId: br.branchId,
          branchCode: br.branchCode,
          businessDate,
          time: slot.time,
          dayOffset: (slot.dayOffset ?? 0) as 0 | 1,
          startAtIso: toIsoCairo(businessDate, slot.time, (slot.dayOffset ?? 0) as 0 | 1),
          labelAr: `فرع آخر (${br.branchName}) — يتطلب إلغاء وإعادة حجز`,
        });
        break;
      }
    } catch {
      /* optional */
    }
  }

  void getBranchById;
  return out.sort((a, b) => a.rank - b.rank);
}

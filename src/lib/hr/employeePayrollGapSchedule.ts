import 'server-only';

import { getPool } from '@/lib/db';
import { loadWorkingWindowsBatch } from '@/lib/availability/loadWorkingWindowsBatch';
import { eachDateInclusive } from '@/lib/hr/employeePayrollGapReview.classify';

const DAY_NAMES_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export type EmployeeScheduleOffContext = {
  /** Distinct weekly off days from branch/legacy schedule (0=Sun … 6=Sat). */
  offDaysOfWeek: number[];
  offDayLabelsAr: string[];
  /** Per calendar date — false if scheduled working day or unknown. */
  offByDate: Map<string, boolean>;
};

function dayOfWeekFromDate(workDate: string): number {
  return new Date(`${workDate}T12:00:00`).getDay();
}

async function loadWeeklyOffDaysOfWeek(
  empId: number,
  branchId: number,
): Promise<number[]> {
  const db = await getPool();
  const off = new Set<number>();

  try {
    const { ensureEmpBranchWorkScheduleTable } = await import('@/lib/hr/empBranchWorkSchedule');
    await ensureEmpBranchWorkScheduleTable();
    const branchRes = await db.request().input('empId', empId).input('branchId', branchId).query(`
      SELECT DISTINCT s.DayOfWeek
      FROM dbo.TblEmpBranchWorkSchedule s
      WHERE s.EmpID = @empId AND s.BranchID = @branchId
        AND s.IsActive = 1 AND s.IsWorking = 0
    `);
    for (const row of branchRes.recordset as Array<{ DayOfWeek: number }>) {
      off.add(Number(row.DayOfWeek));
    }
  } catch {
    /* optional table */
  }

  if (off.size === 0) {
    try {
      const legacyRes = await db.request().input('empId', empId).query(`
        SELECT DISTINCT DayOfWeek
        FROM dbo.TblEmpWorkSchedule
        WHERE EmpID = @empId AND IsWorkingDay = 0
      `);
      for (const row of legacyRes.recordset as Array<{ DayOfWeek: number }>) {
        off.add(Number(row.DayOfWeek));
      }
    } catch {
      /* ignore */
    }
  }

  return [...off].sort((a, b) => a - b);
}

/**
 * Resolve per-date scheduled off using branch weekly schedule + transfers (same loader as booking).
 */
export async function buildEmployeeScheduleOffContext(params: {
  empId: number;
  branchId: number;
  startDate: string;
  endDate: string;
}): Promise<EmployeeScheduleOffContext> {
  const offDaysOfWeek = await loadWeeklyOffDaysOfWeek(params.empId, params.branchId);
  const offDayLabelsAr = offDaysOfWeek.map((d) => DAY_NAMES_AR[d] ?? String(d));

  const db = await getPool();
  const offByDate = new Map<string, boolean>();
  const dates = eachDateInclusive(params.startDate, params.endDate);

  await Promise.all(
    dates.map(async (workDate) => {
      const dow = dayOfWeekFromDate(workDate);
      const windows = await loadWorkingWindowsBatch(db, [params.empId], dow, {
        branchId: params.branchId,
        workDate,
      });
      const row = windows.get(params.empId);
      if (row) {
        offByDate.set(workDate, !row.isWorkingDay);
        return;
      }
      // No schedule row — fall back to weekly off-day list only.
      offByDate.set(workDate, offDaysOfWeek.includes(dow));
    }),
  );

  return { offDaysOfWeek, offDayLabelsAr, offByDate };
}

export function isEmployeeScheduledOffDay(
  workDate: string,
  offByDate: Map<string, boolean>,
): boolean {
  return offByDate.get(workDate) === true;
}

export function formatEmployeeOffDaysLabel(offDayLabelsAr: string[]): string {
  if (offDayLabelsAr.length === 0) return 'لا يوجد يوم إجازة في الجدول';
  if (offDayLabelsAr.length === 1) return offDayLabelsAr[0]!;
  return offDayLabelsAr.join(' · ');
}

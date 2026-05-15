import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ValidationMissing {
  empId:   number;
  empName: string;
  reason:  'no_attendance' | 'missing_checkout' | 'missing_checkin' | 'no_hourly_rate';
}

// POST /api/payroll/daily/validate-attendance
// Body: { workDate: "YYYY-MM-DD" }
// Returns: { ok, missing[], alreadyPosted[], generatedExists }
export async function POST(req: NextRequest) {
  try {
    const { workDate } = await req.json();

    if (!workDate || !DATE_RE.test(workDate)) {
      return NextResponse.json({ error: 'workDate مطلوب بصيغة YYYY-MM-DD' }, { status: 400 });
    }

    const db = await getPool();

    // ── 1. Check for already-posted rows ──────────────────────────────────────
    const postedResult = await db.request()
      .input('WorkDate', sql.Date, workDate)
      .query(`
        SELECT COUNT(*) AS cnt
        FROM dbo.TblEmpDailyPayroll
        WHERE WorkDate = @WorkDate AND Status = N'PostedToCashMove'
      `);
    const alreadyPostedCount: number = postedResult.recordset[0].cnt;

    // ── 2. Check for already-generated (but not posted) rows ─────────────────
    const generatedResult = await db.request()
      .input('WorkDate', sql.Date, workDate)
      .query(`
        SELECT COUNT(*) AS cnt
        FROM dbo.TblEmpDailyPayroll
        WHERE WorkDate = @WorkDate AND Status IN (N'Generated', N'Earned')
      `);
    const generatedExists: boolean = generatedResult.recordset[0].cnt > 0;

    // ── 3. Get all eligible employees (active, payroll enabled, hourly) ───────
    const eligibleResult = await db.request()
      .query(`
        SELECT EmpID, EmpName, HourlyRate
        FROM dbo.TblEmp
        WHERE isActive = 1
          AND IsPayrollEnabled = 1
          AND SalaryType = N'Daily'
      `);
    const eligible: Array<{ EmpID: number; EmpName: string; HourlyRate: number | null }> =
      eligibleResult.recordset;

    if (eligible.length === 0) {
      return NextResponse.json({
        ok: true,
        missing: [],
        alreadyPostedCount,
        generatedExists,
        message: 'لا يوجد موظفون مؤهلون لنظام الرواتب',
      });
    }

    // ── 4. Get attendance records for this date (all statuses) ─────────────────
    const attResult = await db.request()
      .input('WorkDate', sql.Date, workDate)
      .query(`
        SELECT
          a.EmpID,
          a.Status        AS AttStatus,
          a.CheckInTime,
          a.CheckOutTime
        FROM dbo.TblEmpAttendance a
        WHERE a.WorkDate = @WorkDate
      `);
    const attMap = new Map<number, { AttStatus: string; CheckInTime: unknown; CheckOutTime: unknown }>(
      attResult.recordset.map((r: any) => [r.EmpID, r])
    );

    // Statuses that do NOT require CheckIn/CheckOut
    const EXEMPT_STATUSES = new Set(['إجازة', 'DayOff', 'Holiday', 'غائب', 'Absent', 'Leave']);

    // ── 5. Build missing list ─────────────────────────────────────────────────
    const missing: ValidationMissing[] = [];

    for (const emp of eligible) {
      const att = attMap.get(emp.EmpID);

      // If employee has an attendance record with an exempt status, skip entirely
      if (att && EXEMPT_STATUSES.has(att.AttStatus)) continue;

      // If no attendance record at all — no_attendance
      if (!att) {
        missing.push({ empId: emp.EmpID, empName: emp.EmpName, reason: 'no_attendance' });
        continue;
      }

      // For working employees (Present/Late/etc.) check HourlyRate and times
      if (!emp.HourlyRate || emp.HourlyRate <= 0) {
        missing.push({ empId: emp.EmpID, empName: emp.EmpName, reason: 'no_hourly_rate' });
        continue;
      }

      if (!att.CheckInTime) {
        missing.push({ empId: emp.EmpID, empName: emp.EmpName, reason: 'missing_checkin' });
        continue;
      }

      if (!att.CheckOutTime) {
        missing.push({ empId: emp.EmpID, empName: emp.EmpName, reason: 'missing_checkout' });
        continue;
      }
    }

    return NextResponse.json({
      ok:               missing.length === 0,
      missing,
      alreadyPostedCount,
      generatedExists,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/payroll/daily/validate-attendance] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

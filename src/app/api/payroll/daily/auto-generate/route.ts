import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import type { ValidationMissing } from '../validate-attendance/route';

// ── Business-day logic ────────────────────────────────────────────────────────
// If called after midnight but before 06:00, treat the work date as yesterday
// (because 01:00 AM is still within the previous day's work shift).
function resolveWorkDate(override?: string): string {
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) return override;
  const now = new Date();
  const hour = now.getHours();
  const target = new Date(now);
  if (hour < 6) target.setDate(target.getDate() - 1);
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
}

// ── Actual hours SQL expression (midnight-crossover safe) ─────────────────────
const ACTUAL_HOURS_EXPR = `
  CASE
    WHEN a.CheckInTime IS NULL OR a.CheckOutTime IS NULL THEN NULL
    WHEN a.CheckOutTime > a.CheckInTime
      THEN CAST(DATEDIFF(MINUTE, a.CheckInTime, a.CheckOutTime) AS DECIMAL(10,2)) / 60.0
    WHEN a.CheckOutTime < a.CheckInTime
      THEN CAST(
        DATEDIFF(
          MINUTE,
          CAST(a.CheckInTime  AS DATETIME),
          DATEADD(DAY, 1, CAST(a.CheckOutTime AS DATETIME))
        ) AS DECIMAL(10,2)
      ) / 60.0
    ELSE 0
  END
`;

// POST /api/payroll/daily/auto-generate
// Protected by CRON_SECRET header.
// Body (optional): { workDate?: "YYYY-MM-DD" }
//
// Designed to be called by:
//   - Vercel Cron Jobs (Authorization: Bearer <CRON_SECRET>)
//   - Windows Task Scheduler (curl with same header)
//   - Any internal scheduler
//
// Returns a structured result — NEVER posts to cash (manual step only).
export async function POST(req: NextRequest) {
  try {
    // ── Auth: require CRON_SECRET ─────────────────────────────────────────────
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const authHeader = req.headers.get('authorization') ?? '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
      if (token !== secret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const body = await req.json().catch(() => ({}));
    const workDate = resolveWorkDate(body?.workDate);

    const db = await getPool();

    // ── 1. Block if already posted ────────────────────────────────────────────
    const postedCheck = await db.request()
      .input('WorkDate', sql.Date, workDate)
      .query(`
        SELECT COUNT(*) AS cnt
        FROM dbo.TblEmpDailyPayroll
        WHERE WorkDate = @WorkDate AND Status = N'PostedToCashMove'
      `);
    if (postedCheck.recordset[0].cnt > 0) {
      return NextResponse.json({
        ok:       false,
        status:   'already_posted',
        workDate,
        message:  'يوجد يوميات مرحلة للخزنة لهذا التاريخ، لا يمكن إعادة توليدها.',
      }, { status: 409 });
    }

    // ── 2. Validate attendance ────────────────────────────────────────────────
    const eligibleResult = await db.request().query(`
      SELECT EmpID, EmpName, HourlyRate
      FROM dbo.TblEmp
      WHERE isActive = 1 AND IsPayrollEnabled = 1 AND SalaryType = N'Daily'
    `);
    const eligible: Array<{ EmpID: number; EmpName: string; HourlyRate: number | null }> =
      eligibleResult.recordset;

    if (eligible.length === 0) {
      return NextResponse.json({
        ok:      true,
        status:  'no_eligible_employees',
        workDate,
        message: 'لا يوجد موظفون مؤهلون لنظام الرواتب',
        employeesCount: 0,
        totalHours:     0,
        totalWages:     0,
      });
    }

    const attResult = await db.request()
      .input('WorkDate', sql.Date, workDate)
      .query(`
        SELECT EmpID, Status, CheckInTime, CheckOutTime
        FROM dbo.TblEmpAttendance
        WHERE WorkDate = @WorkDate
      `);
    const attMap = new Map<number, { Status: string; CheckInTime: unknown; CheckOutTime: unknown }>(
      attResult.recordset.map((r: any) => [r.EmpID, r])
    );

    const EXEMPT_STATUSES = new Set(['إجازة', 'DayOff', 'Holiday', 'غائب', 'Absent', 'Leave']);

    const missing: ValidationMissing[] = [];
    for (const emp of eligible) {
      const att = attMap.get(emp.EmpID);
      if (att && EXEMPT_STATUSES.has(att.Status)) continue;
      if (!emp.HourlyRate || emp.HourlyRate <= 0) {
        missing.push({ empId: emp.EmpID, empName: emp.EmpName, reason: 'no_hourly_rate' });
        continue;
      }
      if (!att)              { missing.push({ empId: emp.EmpID, empName: emp.EmpName, reason: 'no_attendance'    }); continue; }
      if (!att.CheckInTime)  { missing.push({ empId: emp.EmpID, empName: emp.EmpName, reason: 'missing_checkin'  }); continue; }
      if (!att.CheckOutTime) { missing.push({ empId: emp.EmpID, empName: emp.EmpName, reason: 'missing_checkout' }); continue; }
    }

    if (missing.length > 0) {
      // Log to auto-generate log table (best-effort)
      await logAutoGenResult(db, workDate, false, missing, 0, 0, 0);

      return NextResponse.json({
        ok:      false,
        status:  'attendance_incomplete',
        workDate,
        message: 'لم يتم توليد اليوميات تلقائيًا بسبب نقص بيانات الحضور والانصراف',
        missing,
      }, { status: 422 });
    }

    // ── 3a. UPDATE existing non-posted rows ───────────────────────────────────
    await db.request()
      .input('WorkDate', sql.Date, workDate)
      .query(`
        UPDATE p
        SET
          p.HourlyRateSnapshot = e.HourlyRate,
          p.ActualHours        = ${ACTUAL_HOURS_EXPR},
          p.DailyWage          =
            CASE
              WHEN a.CheckInTime IS NOT NULL AND a.CheckOutTime IS NOT NULL AND e.HourlyRate IS NOT NULL
              THEN CAST(e.HourlyRate AS DECIMAL(10,4)) * (${ACTUAL_HOURS_EXPR})
              ELSE 0
            END,
          p.Status             = N'Generated',
          p.Notes              =
            N'[Auto] Hourly: ' + CAST(ISNULL(e.HourlyRate, 0) AS NVARCHAR(20))
            + N' x ' + CAST(ISNULL(${ACTUAL_HOURS_EXPR}, 0) AS NVARCHAR(10))
            + N'h | ' + ISNULL(a.Status, N''),
          p.UpdatedAt          = GETDATE()
        FROM dbo.TblEmpDailyPayroll p
        INNER JOIN dbo.TblEmpAttendance a ON a.ID = p.AttendanceID
        INNER JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
        WHERE p.WorkDate = @WorkDate
          AND p.Status IN (N'Generated', N'Earned', N'PendingCheckout')
      `);

    // ── 3b. INSERT new rows ───────────────────────────────────────────────────
    await db.request()
      .input('WorkDate', sql.Date, workDate)
      .query(`
        INSERT INTO dbo.TblEmpDailyPayroll
          (EmpID, AttendanceID, WorkDate, SalaryHistoryID,
           HourlyRateSnapshot, ActualHours, DailyWage, Status, Notes)
        SELECT
          a.EmpID,
          a.ID                                                    AS AttendanceID,
          a.WorkDate,
          h.ID                                                    AS SalaryHistoryID,
          e.HourlyRate                                            AS HourlyRateSnapshot,
          ${ACTUAL_HOURS_EXPR}                                    AS ActualHours,
          CASE
            WHEN a.CheckInTime IS NOT NULL AND a.CheckOutTime IS NOT NULL AND e.HourlyRate IS NOT NULL
            THEN CAST(e.HourlyRate AS DECIMAL(10,4)) * (${ACTUAL_HOURS_EXPR})
            ELSE 0
          END                                                     AS DailyWage,
          N'Generated'                                            AS Status,
          N'[Auto] Hourly: ' + CAST(ISNULL(e.HourlyRate,0) AS NVARCHAR(20))
            + N' x ' + CAST(ISNULL(${ACTUAL_HOURS_EXPR},0) AS NVARCHAR(10))
            + N'h | ' + ISNULL(a.Status, N'')                   AS Notes
        FROM dbo.TblEmpAttendance a
        INNER JOIN dbo.TblEmp e
          ON e.EmpID = a.EmpID
        INNER JOIN dbo.TblEmpSalaryHistory h
          ON h.EmpID = e.EmpID AND h.IsActive = 1 AND h.EffectiveTo IS NULL
        WHERE a.WorkDate = @WorkDate
          AND e.isActive = 1
          AND e.IsPayrollEnabled = 1
          AND e.SalaryType = N'Daily'
          AND ISNULL(e.HourlyRate, 0) > 0
          AND a.Status IN (N'Present', N'Late')
          AND NOT EXISTS (
            SELECT 1 FROM dbo.TblEmpDailyPayroll p
            WHERE p.EmpID = a.EmpID AND p.WorkDate = a.WorkDate
          );
      `);

    // ── 4. Summary ────────────────────────────────────────────────────────────
    const summaryResult = await db.request()
      .input('WorkDate', sql.Date, workDate)
      .query(`
        SELECT
          COUNT(*)         AS total,
          SUM(ActualHours) AS totalHours,
          SUM(DailyWage)   AS totalWages
        FROM dbo.TblEmpDailyPayroll
        WHERE WorkDate = @WorkDate AND Status = N'Generated'
      `);
    const s = summaryResult.recordset[0];
    const employeesCount = s.total      ?? 0;
    const totalHours     = s.totalHours ?? 0;
    const totalWages     = s.totalWages ?? 0;

    await logAutoGenResult(db, workDate, true, [], employeesCount, totalHours, totalWages);

    return NextResponse.json({
      ok:             true,
      status:         'generated',
      workDate,
      message:        'تم توليد اليوميات تلقائيًا ولم يتم ترحيلها للخزنة بعد',
      employeesCount,
      totalHours:     Number(totalHours),
      totalWages:     Number(totalWages),
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/payroll/daily/auto-generate] error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// ── GET: return last auto-generate result for a given workDate ────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const workDate = searchParams.get('workDate') ?? resolveWorkDate();

    const db = await getPool();
    const result = await db.request()
      .input('WorkDate', sql.Date, workDate)
      .query(`
        SELECT TOP 1
          WorkDate, Success, EmployeesCount, TotalHours, TotalWages,
          MissingJson, CreatedAt
        FROM dbo.TblAutoGenLog
        WHERE WorkDate = @WorkDate
        ORDER BY CreatedAt DESC
      `).catch(() => ({ recordset: [] as any[] }));

    if (result.recordset.length === 0) {
      return NextResponse.json({ found: false, workDate });
    }

    const row = result.recordset[0];
    return NextResponse.json({
      found:          true,
      workDate:       row.WorkDate,
      success:        row.Success,
      employeesCount: row.EmployeesCount,
      totalHours:     row.TotalHours,
      totalWages:     row.TotalWages,
      missing:        row.MissingJson ? JSON.parse(row.MissingJson) : [],
      createdAt:      row.CreatedAt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── Helper: write auto-generate log (best-effort, table may not exist yet) ────
async function logAutoGenResult(
  db: any,
  workDate: string,
  success: boolean,
  missing: ValidationMissing[],
  employeesCount: number,
  totalHours: number,
  totalWages: number,
) {
  try {
    await db.request()
      .input('WorkDate',       sql.Date,           workDate)
      .input('Success',        sql.Bit,             success ? 1 : 0)
      .input('EmployeesCount', sql.Int,             employeesCount)
      .input('TotalHours',     sql.Decimal(10, 2),  totalHours)
      .input('TotalWages',     sql.Decimal(12, 2),  totalWages)
      .input('MissingJson',    sql.NVarChar(sql.MAX), missing.length ? JSON.stringify(missing) : null)
      .query(`
        IF OBJECT_ID('dbo.TblAutoGenLog', 'U') IS NOT NULL
        BEGIN
          INSERT INTO dbo.TblAutoGenLog
            (WorkDate, Success, EmployeesCount, TotalHours, TotalWages, MissingJson, CreatedAt)
          VALUES
            (@WorkDate, @Success, @EmployeesCount, @TotalHours, @TotalWages, @MissingJson, GETDATE())
        END
      `);
  } catch {
    // Non-fatal — log table might not exist yet
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import type { ValidationMissing } from '../validate-attendance/route';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Shared SQL expression: actual hours with midnight-crossover support
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

// POST /api/payroll/daily/generate
// Body: { workDate: "YYYY-MM-DD" }
//
// Flow:
//  1. Block if any PostedToCashMove rows exist for this date
//  2. Validate attendance completeness; abort with missing list if any gaps
//  3. INSERT new rows (Status = 'Generated') or UPDATE existing non-posted rows
export async function POST(req: NextRequest) {
  try {
    const { workDate } = await req.json();

    if (!workDate || !DATE_RE.test(workDate)) {
      return NextResponse.json(
        { error: 'workDate مطلوب بصيغة YYYY-MM-DD' },
        { status: 400 }
      );
    }

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
        error: 'يوجد يوميات مرحلة للخزنة لهذا التاريخ، لا يمكن إعادة توليدها إلا بعد إلغاء أو تصحيح الترحيل.',
        alreadyPosted: true,
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
      return NextResponse.json({
        error:   'برجاء إكمال بيانات الحضور والانصراف أولاً',
        missing,
        ok:      false,
      }, { status: 422 });
    }

    // ── 3a. UPDATE existing Generated/Earned rows for this date ──────────────
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
            N'Hourly: ' + CAST(ISNULL(e.HourlyRate, 0) AS NVARCHAR(20))
            + N' x ' + CAST(ISNULL(${ACTUAL_HOURS_EXPR}, 0) AS NVARCHAR(10))
            + N'h | ' + ISNULL(a.Status, N''),
          p.UpdatedAt          = GETDATE()
        FROM dbo.TblEmpDailyPayroll p
        INNER JOIN dbo.TblEmpAttendance a ON a.ID = p.AttendanceID
        INNER JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
        WHERE p.WorkDate = @WorkDate
          AND p.Status IN (N'Generated', N'Earned', N'PendingCheckout')
      `);

    // ── 3b. INSERT new rows (employees with no existing payroll row) ──────────
    const insertResult = await db.request()
      .input('WorkDate', sql.Date, workDate)
      .query(`
        INSERT INTO dbo.TblEmpDailyPayroll
          (EmpID, AttendanceID, WorkDate, SalaryHistoryID,
           HourlyRateSnapshot, ActualHours, DailyWage, Status, Notes)
        OUTPUT
          INSERTED.ID, INSERTED.EmpID, INSERTED.WorkDate,
          INSERTED.HourlyRateSnapshot, INSERTED.ActualHours,
          INSERTED.DailyWage, INSERTED.Status, INSERTED.Notes
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
          N'Hourly: ' + CAST(ISNULL(e.HourlyRate,0) AS NVARCHAR(20))
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

    const newRows = insertResult.recordset;

    // ── 4. Return summary ─────────────────────────────────────────────────────
    const summaryResult = await db.request()
      .input('WorkDate', sql.Date, workDate)
      .query(`
        SELECT
          COUNT(*)                    AS total,
          SUM(ActualHours)            AS totalHours,
          SUM(DailyWage)              AS totalWage
        FROM dbo.TblEmpDailyPayroll
        WHERE WorkDate = @WorkDate AND Status = N'Generated'
      `);
    const summary = summaryResult.recordset[0];

    return NextResponse.json({
      success:        true,
      workDate,
      generatedCount: summary.total       ?? 0,
      totalHours:     summary.totalHours  ?? 0,
      totalWage:      summary.totalWage   ?? 0,
      newRows:        newRows.length,
    }, { status: 201 });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/payroll/daily/generate] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

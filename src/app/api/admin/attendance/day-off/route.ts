import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import {
  isActiveBranchContext,
  requireBranchOperationAccess,
} from '@/lib/branch';

/**
 * GET /api/admin/attendance/day-off?date=YYYY-MM-DD&query=
 * Employees scheduled off today (weekly leave / day_off override)
 * who are not already Present at the active branch.
 *
 * Note: dbo.TblEmpDayOff is optional and may not exist in all environments.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const { searchParams } = new URL(req.url);
    const dateStr = searchParams.get('date');
    const query = (searchParams.get('query') || '').trim();

    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return NextResponse.json(
        { error: 'التاريخ مطلوب بصيغة YYYY-MM-DD' },
        { status: 400 },
      );
    }

    const dayOfWeek = new Date(`${dateStr}T12:00:00Z`).getDay();
    const db = await getPool();

    const { ensureEmpBranchWorkScheduleTable } = await import(
      '@/lib/hr/empBranchWorkSchedule'
    );
    await ensureEmpBranchWorkScheduleTable();

    const tableCheck = await db.request().query(`
      SELECT
        CASE WHEN OBJECT_ID(N'dbo.TblEmpDayOff', N'U') IS NOT NULL THEN 1 ELSE 0 END AS HasDayOff,
        CASE WHEN OBJECT_ID(N'dbo.TblEmpScheduleOverrides', N'U') IS NOT NULL THEN 1 ELSE 0 END AS HasOverrides
    `);
    const hasDayOff = Number(tableCheck.recordset[0]?.HasDayOff) === 1;
    const hasOverrides = Number(tableCheck.recordset[0]?.HasOverrides) === 1;

    const dayOffApply = hasDayOff
      ? `
        OUTER APPLY (
          SELECT TOP 1 d.EmpID
          FROM dbo.TblEmpDayOff d
          WHERE d.EmpID = e.EmpID
            AND d.OffDate = @workDate
            AND ISNULL(d.IsDeleted, 0) = 0
        ) dayOff
      `
      : `
        OUTER APPLY (SELECT CAST(NULL AS INT) AS EmpID WHERE 1 = 0) dayOff
      `;

    const overrideApply = hasOverrides
      ? `
        OUTER APPLY (
          SELECT TOP 1 o.EmpID
          FROM dbo.TblEmpScheduleOverrides o
          WHERE o.EmpID = e.EmpID
            AND o.OverrideDate = @workDate
            AND o.IsActive = 1
            AND o.Type = N'day_off'
        ) ovr
      `
      : `
        OUTER APPLY (SELECT CAST(NULL AS INT) AS EmpID WHERE 1 = 0) ovr
      `;

    const result = await db
      .request()
      .input('workDate', sql.Date, dateStr)
      .input('dayOfWeek', sql.TinyInt, dayOfWeek)
      .input('branchId', sql.Int, branch.branchId)
      .input('query', sql.NVarChar(100), query ? `%${query}%` : null)
      .query(`
        SELECT
          e.EmpID,
          e.EmpName,
          e.EmploymentType,
          CONVERT(VARCHAR(5), e.DefaultCheckInTime, 108) AS DefaultCheckInTime,
          CONVERT(VARCHAR(5), e.DefaultCheckOutTime, 108) AS DefaultCheckOutTime,
          CASE
            WHEN ISNULL(ws.IsWorking, 1) = 0 THEN N'إجازة أسبوعية'
            WHEN dayOff.EmpID IS NOT NULL THEN N'إجازة مسجّلة'
            WHEN ovr.EmpID IS NOT NULL THEN N'إجازة (تعديل يومي)'
            ELSE N'إجازة'
          END AS DayOffReason
        FROM dbo.TblEmp e
        INNER JOIN dbo.TblEmpBranchAssignment ea
          ON ea.EmpID = e.EmpID
          AND ea.BranchID = @branchId
          AND ea.IsActive = 1
          AND ea.EffectiveFrom <= @workDate
          AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= @workDate)
        LEFT JOIN dbo.TblEmpBranchWorkSchedule ws
          ON ws.EmpID = e.EmpID
          AND ws.BranchID = @branchId
          AND ws.DayOfWeek = @dayOfWeek
          AND ws.IsActive = 1
          AND ws.EffectiveFrom <= @workDate
          AND (ws.EffectiveTo IS NULL OR ws.EffectiveTo >= @workDate)
        ${dayOffApply}
        ${overrideApply}
        LEFT JOIN dbo.TblEmpAttendance a
          ON a.EmpID = e.EmpID
          AND a.WorkDate = @workDate
          AND a.BranchID = @branchId
        WHERE ISNULL(e.isActive, 1) = 1
          AND ISNULL(e.EmploymentType, N'') <> N'freelance'
          AND (
            ISNULL(ws.IsWorking, 1) = 0
            OR dayOff.EmpID IS NOT NULL
            OR ovr.EmpID IS NOT NULL
          )
          AND NOT EXISTS (
            SELECT 1
            FROM dbo.TblEmpBranchWorkSchedule s2
            WHERE s2.EmpID = e.EmpID
              AND s2.BranchID <> @branchId
              AND s2.DayOfWeek = @dayOfWeek
              AND s2.IsActive = 1
              AND s2.IsWorking = 1
              AND s2.EffectiveFrom <= @workDate
              AND (s2.EffectiveTo IS NULL OR s2.EffectiveTo >= @workDate)
          )
          AND (
            a.ID IS NULL
            OR a.Status IN (N'DayOff', N'Absent', N'Pending', N'NotRequired')
          )
          AND (@query IS NULL OR e.EmpName LIKE @query)
        ORDER BY e.EmpName
      `);

    const employees = result.recordset.map(
      (row: {
        EmpID: number;
        EmpName: string;
        EmploymentType: string | null;
        DefaultCheckInTime: string | null;
        DefaultCheckOutTime: string | null;
        DayOffReason: string;
      }) => ({
        EmpID: row.EmpID,
        EmpName: row.EmpName,
        EmploymentType: row.EmploymentType,
        DefaultCheckInTime: row.DefaultCheckInTime || null,
        DefaultCheckOutTime: row.DefaultCheckOutTime || null,
        DayOffReason: row.DayOffReason,
      }),
    );

    return NextResponse.json({
      success: true,
      date: dateStr,
      branchId: branch.branchId,
      branchCode: branch.branchCode,
      employees,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/attendance/day-off] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

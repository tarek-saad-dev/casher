import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";

// GET /api/admin/attendance/freelancers?date=YYYY-MM-DD&query=
// Read-only search for freelancers / attendance-exempt employees (manual add to board).
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const dateStr = searchParams.get("date");
    const query = (searchParams.get("query") || "").trim();

    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return NextResponse.json(
        { error: "التاريخ مطلوب بصيغة YYYY-MM-DD" },
        { status: 400 },
      );
    }

    const db = await getPool();
    const result = await db
      .request()
      .input("workDate", sql.Date, dateStr)
      .input("query", sql.NVarChar(100), query ? `%${query}%` : null)
      .query(`
        SELECT
          e.EmpID,
          e.EmpName,
          e.EmploymentType,
          e.IsAttendanceExempt,
          CONVERT(VARCHAR(5), e.DefaultCheckInTime,  108) AS DefaultCheckInTime,
          CONVERT(VARCHAR(5), e.DefaultCheckOutTime, 108) AS DefaultCheckOutTime,
          CASE WHEN a.ID IS NOT NULL THEN 1 ELSE 0 END AS HasAttendanceToday
        FROM dbo.TblEmp e
        LEFT JOIN dbo.TblEmpAttendance a
          ON a.EmpID = e.EmpID AND a.WorkDate = @workDate
        WHERE ISNULL(e.isActive, 1) = 1
          AND (
            e.EmploymentType = 'freelance'
            OR ISNULL(e.IsAttendanceExempt, 0) = 1
          )
          AND (@query IS NULL OR e.EmpName LIKE @query)
        ORDER BY e.EmpName
      `);

    const freelancers = result.recordset.map(
      (row: {
        EmpID: number;
        EmpName: string;
        EmploymentType: string | null;
        IsAttendanceExempt: boolean | number | null;
        DefaultCheckInTime: string | null;
        DefaultCheckOutTime: string | null;
        HasAttendanceToday: boolean | number;
      }) => ({
        EmpID: row.EmpID,
        EmpName: row.EmpName,
        EmploymentType: row.EmploymentType,
        IsAttendanceExempt: row.IsAttendanceExempt === true || row.IsAttendanceExempt === 1,
        DefaultCheckInTime: row.DefaultCheckInTime || null,
        DefaultCheckOutTime: row.DefaultCheckOutTime || null,
        HasAttendanceToday: row.HasAttendanceToday === true || row.HasAttendanceToday === 1,
      }),
    );

    return NextResponse.json({
      success: true,
      date: dateStr,
      freelancers,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/admin/attendance/freelancers] GET error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

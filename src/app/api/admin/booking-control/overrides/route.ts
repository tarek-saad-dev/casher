import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { ensureOverridesTable, OverrideType } from "@/lib/scheduleOverrides";

export const runtime = "nodejs";

const VALID_TYPES: OverrideType[] = [
  "day_off",
  "late_start",
  "early_leave",
  "custom_hours",
  "block_range",
];

function isValidDate(d: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));
}

function isValidTime(t: string): boolean {
  return /^\d{2}:\d{2}$/.test(t);
}

/**
 * GET /api/admin/booking-control/overrides?date=YYYY-MM-DD[&empId=N]
 * Returns all active overrides for the given date (optionally filtered by empId).
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.UserID) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") ?? "";
    const empIdParam = searchParams.get("empId");

    if (!date || !isValidDate(date)) {
      return NextResponse.json(
        { error: "date مطلوب بتنسيق YYYY-MM-DD" },
        { status: 400 },
      );
    }

    const db = await getPool();
    await ensureOverridesTable(db);

    const req2 = db.request().input("odate", sql.Date, date);
    const empFilter = empIdParam ? `AND o.EmpID = ${Number(empIdParam)}` : "";

    const res = await req2.query(`
      SELECT
        o.OverrideID,
        o.EmpID,
        e.EmpName,
        CONVERT(VARCHAR(10), o.OverrideDate, 120) AS OverrideDate,
        o.Type,
        CASE WHEN o.StartTime IS NOT NULL
             THEN LEFT(CONVERT(VARCHAR(8), o.StartTime, 108), 5)
             ELSE NULL END AS StartTime,
        CASE WHEN o.EndTime IS NOT NULL
             THEN LEFT(CONVERT(VARCHAR(8), o.EndTime, 108), 5)
             ELSE NULL END AS EndTime,
        o.Reason,
        o.IsActive,
        CONVERT(VARCHAR(30), o.CreatedAt, 126) AS CreatedAt,
        o.CreatedBy
      FROM dbo.TblEmpScheduleOverrides o
      JOIN dbo.TblEmp e ON e.EmpID = o.EmpID
      WHERE o.OverrideDate = @odate
        AND o.IsActive = 1
        ${empFilter}
      ORDER BY o.EmpID, o.OverrideID
    `);

    return NextResponse.json({ ok: true, overrides: res.recordset });
  } catch (err) {
    console.error("[booking-control/overrides GET]", err);
    return NextResponse.json(
      { error: "فشل تحميل الاستثناءات" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/admin/booking-control/overrides
 * Create a new schedule override.
 *
 * Body: { empId, date, type, startTime?, endTime?, reason? }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.UserID) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const body = await req.json();
    const { empId, date, type, startTime, endTime, reason } = body;

    if (!empId || typeof empId !== "number") {
      return NextResponse.json({ error: "empId مطلوب (رقم)" }, { status: 400 });
    }
    if (!date || !isValidDate(date)) {
      return NextResponse.json(
        { error: "date مطلوب بتنسيق YYYY-MM-DD" },
        { status: 400 },
      );
    }
    if (!type || !VALID_TYPES.includes(type)) {
      return NextResponse.json(
        {
          error: `type غير صالح. القيم المسموح بها: ${VALID_TYPES.join(", ")}`,
        },
        { status: 400 },
      );
    }
    if (
      (type === "late_start" ||
        type === "custom_hours" ||
        type === "block_range") &&
      startTime &&
      !isValidTime(startTime)
    ) {
      return NextResponse.json(
        { error: "startTime يجب أن يكون HH:MM" },
        { status: 400 },
      );
    }
    if (
      (type === "early_leave" ||
        type === "custom_hours" ||
        type === "block_range") &&
      endTime &&
      !isValidTime(endTime)
    ) {
      return NextResponse.json(
        { error: "endTime يجب أن يكون HH:MM" },
        { status: 400 },
      );
    }

    // Semantic cross-field validation
    if (type === "late_start" && !startTime) {
      return NextResponse.json({ error: "late_start يتطلب startTime" }, { status: 400 });
    }
    if (type === "early_leave" && !endTime) {
      return NextResponse.json({ error: "early_leave يتطلب endTime" }, { status: 400 });
    }
    if (type === "block_range" && (!startTime || !endTime)) {
      return NextResponse.json({ error: "block_range يتطلب startTime و endTime" }, { status: 400 });
    }
    if (type === "custom_hours" && (!startTime || !endTime)) {
      return NextResponse.json({ error: "custom_hours يتطلب startTime و endTime" }, { status: 400 });
    }
    // For block_range and custom_hours: startTime must be strictly before endTime (overnight not allowed)
    if ((type === "block_range" || type === "custom_hours") && startTime && endTime) {
      const [sh, sm] = startTime.split(":").map(Number);
      const [eh, em] = endTime.split(":").map(Number);
      const startMin = sh * 60 + sm;
      const endMin   = eh * 60 + em;
      if (type === "block_range" && startMin >= endMin) {
        return NextResponse.json({ error: "block_range: startTime يجب أن يكون قبل endTime" }, { status: 400 });
      }
    }

    const db = await getPool();
    await ensureOverridesTable(db);

    const createdBy = session.UserName ?? session.UserID?.toString() ?? "admin";

    const ins = db
      .request()
      .input("empId", sql.Int, empId)
      .input("odate", sql.Date, date)
      .input("otype", sql.NVarChar(30), type)
      .input("startTime", sql.NVarChar(5), startTime ?? null)
      .input("endTime", sql.NVarChar(5), endTime ?? null)
      .input("reason", sql.NVarChar(300), reason ?? null)
      .input("createdBy", sql.NVarChar(100), createdBy);

    const res = await ins.query(`
      INSERT INTO dbo.TblEmpScheduleOverrides
        (EmpID, OverrideDate, Type, StartTime, EndTime, Reason, IsActive, CreatedBy)
      OUTPUT INSERTED.OverrideID
      VALUES
        (@empId, @odate, @otype,
         TRY_CAST(@startTime AS TIME),
         TRY_CAST(@endTime  AS TIME),
         @reason, 1, @createdBy)
    `);

    const newId = res.recordset[0]?.OverrideID;
    console.log(
      `[booking-control/overrides] created OverrideID=${newId} empId=${empId} date=${date} type=${type}`,
    );

    return NextResponse.json({ ok: true, overrideId: newId }, { status: 201 });
  } catch (err) {
    console.error("[booking-control/overrides POST]", err);
    return NextResponse.json({ error: "فشل إنشاء الاستثناء" }, { status: 500 });
  }
}

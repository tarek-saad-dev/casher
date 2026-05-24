/**
 * Debug endpoint: GET /api/debug/booking-schedule-check
 *
 * Returns schedule data for testing purposes.
 * ONLY available in development mode.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";

// Day names in English for consistency
const DAY_NAMES = [
  "Sunday", // 0
  "Monday", // 1
  "Tuesday", // 2
  "Wednesday", // 3
  "Thursday", // 4
  "Friday", // 5
  "Saturday", // 6
];

export async function GET(_req: NextRequest) {
  // Only allow in development mode
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Not available in production" },
      { status: 404 },
    );
  }

  try {
    const db = await getPool();

    // Get schedule for the 4 barbers
    const result = await db.request().query(`
      SELECT
        ws.EmpID,
        e.EmpName,
        ws.DayOfWeek,
        ws.IsWorking,
        CONVERT(VARCHAR(5), ws.StartTime, 108) AS StartTime,
        CONVERT(VARCHAR(5), ws.EndTime, 108) AS EndTime
      FROM TblEmpWorkSchedule ws
      JOIN TblEmp e ON e.EmpID = ws.EmpID
      WHERE e.EmpName IN (N'أحمد', N'ذياد', N'كريم', N'عمر')
      ORDER BY e.EmpID, ws.DayOfWeek
    `);

    // Group by employee
    const scheduleByEmp: Record<
      number,
      {
        empId: number;
        empName: string;
        schedule: Array<{
          dayOfWeek: number;
          dayName: string;
          isWorking: boolean;
          startTime: string | null;
          endTime: string | null;
        }>;
      }
    > = {};

    for (const row of result.recordset) {
      if (!scheduleByEmp[row.EmpID]) {
        scheduleByEmp[row.EmpID] = {
          empId: row.EmpID,
          empName: row.EmpName,
          schedule: [],
        };
      }

      scheduleByEmp[row.EmpID].schedule.push({
        dayOfWeek: row.DayOfWeek,
        dayName: DAY_NAMES[row.DayOfWeek],
        isWorking: row.IsWorking === 1 || row.IsWorking === true,
        startTime: row.StartTime,
        endTime: row.EndTime,
      });
    }

    return NextResponse.json({
      ok: true,
      environment: process.env.NODE_ENV || "unknown",
      timestamp: new Date().toISOString(),
      data: Object.values(scheduleByEmp),
    });
  } catch (err) {
    console.error("[debug/booking-schedule-check] error:", err);
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to fetch schedule data",
        details: errMsg,
      },
      { status: 500 },
    );
  }
}

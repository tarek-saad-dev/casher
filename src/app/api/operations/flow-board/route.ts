/**
 * GET /api/operations/flow-board?date=2026-05-24
 *
 * Returns operational dashboard for all barbers on a specific date.
 * Includes timeline, queue counts, booking counts, and next available slots.
 *
 * Response:
 * {
 *   ok: true,
 *   date: "2026-05-24",
 *   barbers: [
 *     {
 *       empId,
 *       empName,
 *       status: "working" | "off" | "day_off",
 *       workStart,
 *       workEnd,
 *       nextAvailableAt,
 *       waitingCount,
 *       bookingsCount,
 *       timeline: [...]
 *     }
 *   ]
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { buildBarberOperationalTimeline } from "@/lib/operationsQueueTimeline";
import { getDefaultDuration, buildQueueIntervals, buildBookingIntervals } from "@/lib/queueEstimateEngine";

export const runtime = "nodejs";

export interface FlowBoardBarber {
  empId: number;
  empName: string;
  status: "working" | "off" | "day_off" | "unknown";
  workStart: string | null;
  workEnd: string | null;
  isOvernightShift: boolean;
  nextAvailableAt: string | null;
  waitingCount: number;
  bookingsCount: number;
  inServiceCount: number;
  timeline: Array<{
    type: "queue" | "booking" | "gap";
    sourceId: number;
    label: string;
    startTime: string;
    endTime: string;
    status: string;
    protected: boolean;
    durationMinutes?: number;
    customerName?: string;
  }>;
}

export interface FlowBoardResponse {
  ok: true;
  date: string;
  generatedAt: string;
  barbers: FlowBoardBarber[];
}

export async function GET(req: NextRequest) {
  try {
    console.log("[flow-board] Request started");
    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get("date");

    // Default to today if no date provided
    const dateStr =
      dateParam ||
      new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });

    console.log("[flow-board] Date:", dateStr);
    console.log("[flow-board] Getting DB pool...");
    let db;
    try {
      db = await getPool();
      console.log("[flow-board] DB pool acquired");
    } catch (dbErr) {
      console.error("[flow-board] DB connection failed:", dbErr);
      return NextResponse.json(
        { ok: false, error: "Database connection failed" },
        { status: 500 }
      );
    }
    const now = new Date();

    // Get all active barbers (only basic info - schedule checked per barber)
    console.log("[flow-board] Fetching active barbers...");
    let barbersRes;
    try {
      // Try with TblEmpDayOff check
      barbersRes = await db.request().query(`
        SELECT 
          e.EmpID, 
          e.EmpName,
          CASE 
            WHEN EXISTS (
              SELECT 1 FROM [dbo].[TblEmpDayOff] 
              WHERE EmpID = e.EmpID 
              AND OffDate = CAST(GETDATE() AS DATE)
              AND IsDeleted = 0
            ) THEN 0
            ELSE 1
          END as IsActuallyWorking
        FROM [dbo].[TblEmp] e
        WHERE e.isActive = 1
        ORDER BY e.EmpName
      `);
    } catch {
      // Fallback if TblEmpDayOff doesn't exist
      console.log("[flow-board] TblEmpDayOff not found, using fallback query");
      barbersRes = await db.request().query(`
        SELECT 
          e.EmpID, 
          e.EmpName,
          1 as IsActuallyWorking
        FROM [dbo].[TblEmp] e
        WHERE e.isActive = 1
        ORDER BY e.EmpName
      `);
    }
    console.log(`[flow-board] Found ${barbersRes.recordset.length} active barbers`);

    const barbers: FlowBoardBarber[] = [];

    for (const barber of barbersRes.recordset) {
      const empId = barber.EmpID;
      const empName = barber.EmpName;

      // Check if barber is off today
      if (!barber.IsActuallyWorking) {
        barbers.push({
          empId,
          empName,
          status: "day_off",
          workStart: null,
          workEnd: null,
          isOvernightShift: false,
          nextAvailableAt: null,
          waitingCount: 0,
          bookingsCount: 0,
          inServiceCount: 0,
          timeline: [],
        });
        continue;
      }

      try {
        // Build timeline for this barber
        const timeline = await buildBarberOperationalTimeline({
          empId,
          date: dateStr,
          now,
        });

        // Get counts
        const defaultDur = await getDefaultDuration(db);
        const qIntervals = await buildQueueIntervals(db, empId, dateStr, now, defaultDur);
        const bIntervals = await buildBookingIntervals(db, empId, dateStr, defaultDur);

        const inServiceCount = qIntervals.filter(
          (q) => q.label === "in_service"
        ).length;

        barbers.push({
          empId,
          empName,
          status: timeline.isWorkingDay ? "working" : "off",
          workStart: timeline.workStart,
          workEnd: timeline.workEnd,
          isOvernightShift: timeline.isOvernightShift,
          nextAvailableAt: timeline.nextAvailableAt,
          waitingCount: timeline.queueCount,
          bookingsCount: timeline.bookingCount,
          inServiceCount,
          timeline: timeline.timeline,
        });
      } catch (err) {
        console.error(`[flow-board] Error loading barber ${empId}:`, err);
        // Add barber with error state
        barbers.push({
          empId,
          empName,
          status: "unknown",
          workStart: null,
          workEnd: null,
          isOvernightShift: false,
          nextAvailableAt: null,
          waitingCount: 0,
          bookingsCount: 0,
          inServiceCount: 0,
          timeline: [],
        });
      }
    }

    const response: FlowBoardResponse = {
      ok: true,
      date: dateStr,
      generatedAt: now.toISOString(),
      barbers,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("[operations/flow-board] error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "فشل في تحميل لوحة التحكم",
      },
      { status: 500 }
    );
  }
}

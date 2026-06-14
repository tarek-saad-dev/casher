/**
 * GET /api/operations/schedule-control?date=YYYY-MM-DD
 *
 * Returns all active barbers with their full day status for the given date:
 *  - default schedule
 *  - effective schedule (after overrides)
 *  - current override
 *  - day-off status
 *  - attendance status (today only)
 *  - currentAvailabilityStatus + statusReasonArabic
 *  - active bookings count
 *  - active queue tickets count
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getBarbersDayStatus, cairoDateStr, BARBER_JOBS_SQL_LIST } from "@/lib/availabilityEngine";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date =
      searchParams.get("date") ??
      new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: "date مطلوب بتنسيق YYYY-MM-DD" },
        { status: 400 },
      );
    }

    const db = await getPool();
    const todayStr = cairoDateStr(new Date());
    const isToday = date === todayStr;

    // 1. Load all active barbers
    const barbersRes = await db.request().query(`
      SELECT EmpID, EmpName, Job
      FROM dbo.TblEmp
      WHERE ISNULL(isActive, 1) = 1
        AND Job IN (${BARBER_JOBS_SQL_LIST})
      ORDER BY EmpName
    `);
    const barbers: Array<{ EmpID: number; EmpName: string; Job: string }> =
      barbersRes.recordset;

    if (!barbers.length) {
      return NextResponse.json({ ok: true, date, isToday, barbers: [] });
    }

    const empIds = barbers.map((b) => b.EmpID);
    const idList = empIds.join(",");

    // 2. Batch-load day statuses (schedules, day-offs, overrides, attendance)
    const statusMap = await getBarbersDayStatus(empIds, date, { isToday });

    // 3. Load active bookings count per barber for this date
    const bookingsRes = await db
      .request()
      .input("bDate", sql.Date, date)
      .query(`
        SELECT AssignedEmpID AS EmpID, COUNT(*) AS BookingCount
        FROM dbo.Bookings
        WHERE BookingDate = @bDate
          AND AssignedEmpID IN (${idList})
          AND Status IN ('confirmed', 'arrived', 'queued', 'in_service')
        GROUP BY AssignedEmpID
      `)
      .catch(() => ({ recordset: [] as any[] }));

    const bookingCountMap = new Map<number, number>();
    for (const r of bookingsRes.recordset) {
      bookingCountMap.set(r.EmpID, r.BookingCount);
    }

    // 4. Load active queue tickets count per barber for this date
    const queueRes = await db
      .request()
      .input("qDate", sql.Date, date)
      .query(`
        SELECT EmpID, COUNT(*) AS QueueCount
        FROM dbo.QueueTickets
        WHERE QueueDate = @qDate
          AND EmpID IN (${idList})
          AND LOWER(Status) IN ('waiting', 'called', 'in_service')
        GROUP BY EmpID
      `)
      .catch(() => ({ recordset: [] as any[] }));

    const queueCountMap = new Map<number, number>();
    for (const r of queueRes.recordset) {
      queueCountMap.set(r.EmpID, r.QueueCount);
    }

    // 5. Debug log: schedule source per barber (always logged for tracing)
    for (const b of barbers) {
      const s = statusMap.get(b.EmpID);
      console.log("[schedule-control] SCHEDULE_DEBUG", {
        empId:           b.EmpID,
        empName:         b.EmpName,
        date,
        dayOfWeek:       new Date(`${date}T12:00:00Z`).getDay(),
        scheduleSource:  s?.schedule.source ?? "unknown",
        baseStart:       s?.schedule.start ?? null,
        baseEnd:         s?.schedule.end ?? null,
        isWorkingDay:    s?.schedule.isWorkingDay ?? false,
        effectiveStart:  s?.effectiveStart ?? null,
        effectiveEnd:    s?.effectiveEnd ?? null,
        appliedOverride: s?.appliedOverride?.Type ?? null,
        isDayOff:        s?.isDayOff ?? false,
      });
    }

    // 6. Assemble response
    const result = barbers.map((b) => {
      const s = statusMap.get(b.EmpID);
      return {
        empId: b.EmpID,
        empName: b.EmpName,
        job: b.Job,

        defaultSchedule: s
          ? {
              isWorkingDay: s.schedule.isWorkingDay,
              start: s.schedule.start,
              end: s.schedule.end,
              source: s.schedule.source,
            }
          : null,

        effectiveSchedule: s
          ? {
              isWorking: s.effectiveSchedule.isWorking,
              start: s.effectiveSchedule.start,
              end: s.effectiveSchedule.end,
              blockedIntervals: s.effectiveSchedule.blockedIntervals,
            }
          : null,

        effectiveStart: s?.effectiveStart ?? null,
        effectiveEnd: s?.effectiveEnd ?? null,
        isWorkingDay: s?.isWorkingDay ?? false,

        isDayOff: s?.isDayOff ?? false,
        isAbsent: s?.isAbsent ?? false,
        isLateStart: s?.isLateStart ?? false,
        isEarlyLeave: s?.isEarlyLeave ?? false,
        isCustomHours: s?.isCustomHours ?? false,

        dayOffReason: s?.dayOffReason ?? null,
        statusReasonArabic: s?.statusReasonArabic ?? "غير معروف",
        currentAvailabilityStatus: s?.currentAvailabilityStatus ?? "unknown",

        appliedOverride: s?.appliedOverride
          ? {
              overrideId: (s.appliedOverride as any).OverrideID ?? null,
              type: s.appliedOverride.Type,
              startTime: s.appliedOverride.StartTime ?? null,
              endTime: s.appliedOverride.EndTime ?? null,
              reason: s.appliedOverride.Reason ?? null,
            }
          : null,

        attendance: s?.attendance ?? null,

        activeBookingsCount: bookingCountMap.get(b.EmpID) ?? 0,
        activeQueueCount: queueCountMap.get(b.EmpID) ?? 0,
      };
    });

    return NextResponse.json({ ok: true, date, isToday, barbers: result });
  } catch (err) {
    console.error("[operations/schedule-control GET]", err);
    return NextResponse.json(
      { error: "فشل تحميل بيانات الجدول" },
      { status: 500 },
    );
  }
}

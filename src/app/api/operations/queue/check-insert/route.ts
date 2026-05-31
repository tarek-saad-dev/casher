/**
 * POST /api/operations/queue/check-insert
 *
 * Booking-aware queue insertion check.
 * Before issuing a walk-in ticket, verify it doesn't conflict with upcoming bookings.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import {
  buildQueueIntervals,
  buildBookingIntervals,
  getDefaultDuration,
  getServicesDuration,
  findFirstFreeSlot,
  cairoDateStr,
  sqlTimeToDate,
} from "@/lib/queueEstimateEngine";
import { getBarberAvailabilityReason } from "@/lib/barberAvailability";

export const runtime = "nodejs";

export interface QueueInsertCheckRequest {
  empId: number;
  serviceIds: number[];
  mode?: "specific" | "nearest";
  requestedAt?: string; // ISO string
  forceManualPriority?: boolean;
}

export interface QueueInsertCheckResponse {
  ok: boolean;
  canInsertBeforeNextBooking: boolean;
  recommendedStartTime: string | null;
  conflictBooking: {
    bookingId: number;
    clientName: string | null;
    startTime: string;
    endTime: string;
    status: string;
  } | null;
  availableGapMinutes: number | null;
  requiredDurationMinutes: number;
  suggestedStartAfterBooking: string | null;
  alternativeBarbers: Array<{
    empId: number;
    empName: string;
    available: boolean;
    estimatedStartTime: string;
    reason?: string;
  }>;
  message: string;
  requiresForceFlag: boolean;
}

// Helper: get alternative barbers
async function getAlternativeBarbers(
  db: Awaited<ReturnType<typeof getPool>>,
  excludeEmpId: number,
  serviceIds: number[],
  now: Date,
  defaultDur: number
): Promise<QueueInsertCheckResponse["alternativeBarbers"]> {
  try {
    // Get all active barbers
    const barbersRes = await db.request().query(`
      SELECT EmpID, EmpName, IsWorkingDay
      FROM [dbo].[TblEmp]
      WHERE IsWorkingDay = 1
        AND EmpID <> ${excludeEmpId}
      ORDER BY EmpName
    `);

    const alternatives: QueueInsertCheckResponse["alternativeBarbers"] = [];

    for (const barber of barbersRes.recordset.slice(0, 5)) {
      // Check if barber is available now
      const avail = await getBarberAvailabilityReason(barber.EmpID, now);

      if (!avail.available) {
        alternatives.push({
          empId: barber.EmpID,
          empName: barber.EmpName,
          available: false,
          estimatedStartTime: "",
          reason: avail.reason || "غير متاح",
        });
        continue;
      }

      // Calculate estimate
      const dateStr = cairoDateStr(now);
      const customerDur = await getServicesDuration(db, serviceIds, defaultDur);

      const qIvs = await buildQueueIntervals(db, barber.EmpID, dateStr, now, defaultDur, undefined, {
        filterStale: true, graceMinutes: 30, debugContext: "check-insert-alt"
      });
      const bIvs = await buildBookingIntervals(db, barber.EmpID, dateStr, defaultDur);
      const allIvs = [...qIvs, ...bIvs].sort((a, b) => a.start.getTime() - b.start.getTime());

      const slot = findFirstFreeSlot(now, customerDur, allIvs);

      alternatives.push({
        empId: barber.EmpID,
        empName: barber.EmpName,
        available: true,
        estimatedStartTime: slot.toISOString(),
      });
    }

    // Sort by availability and then by earliest slot
    return alternatives.sort((a, b) => {
      if (a.available && !b.available) return -1;
      if (!a.available && b.available) return 1;
      if (!a.available && !b.available) return 0;
      return new Date(a.estimatedStartTime).getTime() - new Date(b.estimatedStartTime).getTime();
    });
  } catch (err) {
    console.error("[check-insert] alternatives error:", err);
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as QueueInsertCheckRequest;
    const {
      empId,
      serviceIds = [],
      mode = "specific",
      requestedAt,
      forceManualPriority = false,
    } = body;

    if (!empId) {
      return NextResponse.json(
        { error: "empId مطلوب" },
        { status: 400 }
      );
    }

    const db = await getPool();
    const now = requestedAt ? new Date(requestedAt) : new Date();
    const dateStr = cairoDateStr(now);

    // 1. Check barber availability
    const avail = await getBarberAvailabilityReason(empId, now);
    if (!avail.available) {
      // Get alternatives since this barber is not available
      const defaultDur = await getDefaultDuration(db);
      const alternatives = await getAlternativeBarbers(db, empId, serviceIds, now, defaultDur);

      const response: QueueInsertCheckResponse = {
        ok: false,
        canInsertBeforeNextBooking: false,
        recommendedStartTime: null,
        conflictBooking: null,
        availableGapMinutes: null,
        requiredDurationMinutes: 0,
        suggestedStartAfterBooking: null,
        alternativeBarbers: alternatives,
        message: avail.reason || "الحلاق غير متاح حالياً",
        requiresForceFlag: false,
      };

      return NextResponse.json(response);
    }

    // 2. Calculate service duration
    const defaultDur = await getDefaultDuration(db);
    const customerDur = await getServicesDuration(db, serviceIds, defaultDur);

    // 3. Build timeline for the barber (filter stale queue tickets)
    const qIvs = await buildQueueIntervals(db, empId, dateStr, now, defaultDur, undefined, {
      filterStale: true, graceMinutes: 30, debugContext: "check-insert"
    });
    const bIvs = await buildBookingIntervals(db, empId, dateStr, defaultDur);
    const allIvs = [...qIvs, ...bIvs].sort((a, b) => a.start.getTime() - b.start.getTime());

    // 4. Find next upcoming booking
    const upcomingBookings = bIvs
      .filter((b) => b.start > now)
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    const nextBooking = upcomingBookings[0] || null;

    // 5. Find first free slot
    const candidateSlot = findFirstFreeSlot(now, customerDur, allIvs);
    const candidateEnd = new Date(candidateSlot.getTime() + customerDur * 60000);

    // 6. Check if slot fits before next booking
    let canInsertBeforeNextBooking = false;
    let conflictBooking: QueueInsertCheckResponse["conflictBooking"] = null;
    let suggestedStartAfterBooking: string | null = null;
    let requiresForceFlag = false;
    let message = "";

    if (nextBooking) {
      // Check if our candidate slot ends before or exactly at next booking start
      const slotFits = candidateEnd <= nextBooking.start;

      if (slotFits) {
        canInsertBeforeNextBooking = true;
        message = `يمكن إصدار الدور قبل الحجز القادم (${nextBooking.start.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", hour12: true })})`;
      } else {
        // Slot conflicts with next booking
        canInsertBeforeNextBooking = false;
        requiresForceFlag = true;

        // Load booking details
        const bookingRes = await db
          .request()
          .input("bid", sql.Int, nextBooking.id)
          .query(`
            SELECT b.BookingID, b.StartTime, b.EndTime, b.Status,
                   c.Name AS ClientName
            FROM [dbo].[Bookings] b
            LEFT JOIN [dbo].[TblClient] c ON c.ClientID = b.ClientID
            WHERE b.BookingID = @bid
          `);

        const bRow = bookingRes.recordset[0];
        if (bRow) {
          conflictBooking = {
            bookingId: bRow.BookingID,
            clientName: bRow.ClientName,
            startTime: bRow.StartTime,
            endTime: bRow.EndTime,
            status: bRow.Status,
          };
        }

        // Suggest starting after the booking
        suggestedStartAfterBooking = nextBooking.end.toISOString();

        const gapMinutes = Math.round(
          (nextBooking.start.getTime() - now.getTime()) / 60000
        );

        message = `الدور الجديد (${customerDur} دقيقة) لا يمكن أن ينتهي قبل الحجز القادم (${gapMinutes} دقيقة فقط متاحة). اقتراح: بعد الحجز الساعة ${nextBooking.end.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", hour12: true })}`;
      }
    } else {
      // No upcoming bookings
      canInsertBeforeNextBooking = true;
      message = "لا توجد حجوزات قادمة - يمكن إصدار الدور فوراً";
    }

    // 7. Get alternative barbers
    const alternatives = await getAlternativeBarbers(
      db,
      empId,
      serviceIds,
      now,
      defaultDur
    );

    // 8. Calculate available gap
    let availableGapMinutes: number | null = null;
    if (nextBooking) {
      // Find the end of the last queue item before next booking
      const lastQueueBeforeBooking = qIvs
        .filter((q) => q.end <= nextBooking.start)
        .sort((a, b) => b.end.getTime() - a.end.getTime())[0];

      const effectiveNow = lastQueueBeforeBooking
        ? lastQueueBeforeBooking.end
        : now;

      availableGapMinutes = Math.round(
        (nextBooking.start.getTime() - effectiveNow.getTime()) / 60000
      );
    }

    const response: QueueInsertCheckResponse = {
      ok: canInsertBeforeNextBooking || forceManualPriority,
      canInsertBeforeNextBooking,
      recommendedStartTime: candidateSlot.toISOString(),
      conflictBooking,
      availableGapMinutes,
      requiredDurationMinutes: customerDur,
      suggestedStartAfterBooking,
      alternativeBarbers: alternatives,
      message,
      requiresForceFlag,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("[operations/queue/check-insert] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "فشل فحص إمكانية إصدار الدور" },
      { status: 500 }
    );
  }
}

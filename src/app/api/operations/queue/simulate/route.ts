/**
 * POST /api/operations/queue/simulate
 *
 * Simulates creating a queue ticket without actually creating it.
 * Returns the suggested time, people before, and timeline analysis.
 *
 * Request:
 * {
 *   empId: number,
 *   serviceIds: number[],
 *   requestedAt?: "2026-05-24T15:00:00.000Z" // optional, defaults to now
 * }
 *
 * Response:
 * {
 *   ok: true,
 *   decision: "start_now" | "after_queue" | "after_booking" | "outside_hours",
 *   empId,
 *   empName,
 *   serviceDurationMinutes,
 *   suggestedStartTime,
 *   suggestedEndTime,
 *   peopleBefore,
 *   message,
 *   timeline,
 *   protectedBookings,
 *   queueBefore
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { simulateQueueInsertion } from "@/lib/operationsQueueTimeline";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { empId, serviceIds, requestedAt } = body;

    // Validation
    if (!empId || typeof empId !== "number") {
      return NextResponse.json(
        { ok: false, error: "empId مطلوب ويجب أن يكون رقماً" },
        { status: 400 }
      );
    }

    if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "serviceIds مطلوب ويجب أن يكون مصفوفة" },
        { status: 400 }
      );
    }

    // Run simulation
    const result = await simulateQueueInsertion({
      empId,
      serviceIds,
      requestedAt,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[operations/queue/simulate] error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "فشل في محاكاة إنشاء الدور",
      },
      { status: 500 }
    );
  }
}

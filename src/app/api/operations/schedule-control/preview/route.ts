/**
 * POST /api/operations/schedule-control/preview
 *
 * Body: { empId, date, type, startTime?, endTime? }
 *
 * Returns: { safe, affectedBookings, affectedQueueTickets, warnings,
 *             effectiveSchedulePreview }
 *
 * Pure read-only. Delegates entirely to scheduleControlPreview.computePreview
 * so preview and apply always use identical logic.
 */

import { NextRequest, NextResponse } from "next/server";
import { computePreview } from "@/lib/scheduleControlPreview";
import type { OverrideType } from "@/lib/scheduleOverrides";

export const runtime = "nodejs";

const VALID_TYPES: OverrideType[] = [
  "day_off", "late_start", "early_leave", "custom_hours", "block_range",
];

function isValidDate(d: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));
}
function isValidTime(t: string) {
  return /^\d{2}:\d{2}$/.test(t);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { empId, date, type, startTime, endTime } = body as {
      empId: number;
      date: string;
      type: OverrideType;
      startTime?: string;
      endTime?: string;
    };

    if (!empId || typeof empId !== "number")
      return NextResponse.json({ error: "empId مطلوب" }, { status: 400 });
    if (!date || !isValidDate(date))
      return NextResponse.json({ error: "date غير صالح" }, { status: 400 });
    if (!type || !VALID_TYPES.includes(type))
      return NextResponse.json({ error: "type غير صالح" }, { status: 400 });
    if (startTime && !isValidTime(startTime))
      return NextResponse.json({ error: "startTime يجب أن يكون HH:MM" }, { status: 400 });
    if (endTime && !isValidTime(endTime))
      return NextResponse.json({ error: "endTime يجب أن يكون HH:MM" }, { status: 400 });

    const result = await computePreview(empId, date, type, startTime, endTime);

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[operations/schedule-control/preview]", err);
    return NextResponse.json({ error: "فشل المعاينة" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { OverrideType } from "@/lib/scheduleOverrides";

export const runtime = "nodejs";

const VALID_TYPES: OverrideType[] = [
  "day_off",
  "late_start",
  "early_leave",
  "custom_hours",
  "block_range",
];

function isValidTime(t: string): boolean {
  return /^\d{2}:\d{2}$/.test(t);
}

/**
 * PATCH /api/admin/booking-control/overrides/[id]
 * Update fields of an existing override.
 * Body (all optional): { type?, startTime?, endTime?, reason?, isActive? }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session?.UserID) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const { id } = await params;
    const overrideId = parseInt(id);
    if (isNaN(overrideId) || overrideId <= 0) {
      return NextResponse.json({ error: "id غير صالح" }, { status: 400 });
    }

    const body = await req.json();
    const { type, startTime, endTime, reason, isActive } = body;

    if (type !== undefined && !VALID_TYPES.includes(type)) {
      return NextResponse.json(
        {
          error: `type غير صالح. القيم المسموح بها: ${VALID_TYPES.join(", ")}`,
        },
        { status: 400 },
      );
    }
    if (startTime !== undefined && startTime !== null && !isValidTime(startTime)) {
      return NextResponse.json(
        { error: "startTime يجب أن يكون HH:MM" },
        { status: 400 },
      );
    }
    if (endTime !== undefined && endTime !== null && !isValidTime(endTime)) {
      return NextResponse.json(
        { error: "endTime يجب أن يكون HH:MM" },
        { status: 400 },
      );
    }

    const db = await getPool();

    const updates: string[] = [];
    const r = db.request().input("oid", sql.Int, overrideId);

    if (type !== undefined) {
      updates.push("Type = @otype");
      r.input("otype", sql.NVarChar(30), type);
    }
    if (startTime !== undefined) {
      updates.push("StartTime = TRY_CAST(@startTime AS TIME)");
      r.input("startTime", sql.NVarChar(5), startTime ?? null);
    }
    if (endTime !== undefined) {
      updates.push("EndTime = TRY_CAST(@endTime AS TIME)");
      r.input("endTime", sql.NVarChar(5), endTime ?? null);
    }
    if (reason !== undefined) {
      updates.push("Reason = @reason");
      r.input("reason", sql.NVarChar(300), reason ?? null);
    }
    if (isActive !== undefined) {
      updates.push("IsActive = @isActive");
      r.input("isActive", sql.Bit, isActive ? 1 : 0);
    }

    if (!updates.length) {
      return NextResponse.json(
        { error: "لا توجد حقول للتحديث" },
        { status: 400 },
      );
    }

    const res = await r.query(`
      UPDATE dbo.TblEmpScheduleOverrides
      SET ${updates.join(", ")}
      OUTPUT INSERTED.OverrideID
      WHERE OverrideID = @oid
    `);

    if (!res.recordset.length) {
      return NextResponse.json(
        { error: "الاستثناء غير موجود" },
        { status: 404 },
      );
    }

    console.log(`[booking-control/overrides] updated OverrideID=${overrideId}`);
    return NextResponse.json({ ok: true, overrideId });
  } catch (err) {
    console.error("[booking-control/overrides PATCH]", err);
    return NextResponse.json(
      { error: "فشل تحديث الاستثناء" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/admin/booking-control/overrides/[id]
 * Soft-delete (sets IsActive = 0).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session?.UserID) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const { id } = await params;
    const overrideId = parseInt(id);
    if (isNaN(overrideId) || overrideId <= 0) {
      return NextResponse.json({ error: "id غير صالح" }, { status: 400 });
    }

    const db = await getPool();

    const res = await db
      .request()
      .input("oid", sql.Int, overrideId)
      .query(`
        UPDATE dbo.TblEmpScheduleOverrides
        SET IsActive = 0
        OUTPUT INSERTED.OverrideID
        WHERE OverrideID = @oid
      `);

    if (!res.recordset.length) {
      return NextResponse.json(
        { error: "الاستثناء غير موجود" },
        { status: 404 },
      );
    }

    console.log(
      `[booking-control/overrides] deactivated OverrideID=${overrideId}`,
    );
    return NextResponse.json({ ok: true, overrideId });
  } catch (err) {
    console.error("[booking-control/overrides DELETE]", err);
    return NextResponse.json(
      { error: "فشل حذف الاستثناء" },
      { status: 500 },
    );
  }
}

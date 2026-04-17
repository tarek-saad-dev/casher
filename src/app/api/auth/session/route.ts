import { NextResponse } from "next/server";
import { getSession, destroySession } from "@/lib/session";
import { getPool, getUserFriendlyError, sql } from "@/lib/db";
import { getPermissions } from "@/lib/permissions";

export const runtime = "nodejs";

// GET /api/auth/session — returns full operational session state
export async function GET() {
  try {
    const user = await getSession();
    if (!user) {
      return NextResponse.json({
        user: null,
        day: null,
        shift: null,
        permissions: [],
      });
    }

    const db = await getPool();

    // Get current open business day
    const dayResult = await db.request().query(`
      SELECT TOP 1 ID, NewDay, Status
      FROM [dbo].[TblNewDay]
      WHERE Status = 1
      ORDER BY ID DESC
    `);
    const day = dayResult.recordset.length > 0 ? dayResult.recordset[0] : null;

    // Get current open shift for THIS authenticated user only
    const shiftResult = await db.request().input("userID", sql.Int, user.UserID)
      .query(`
        SELECT TOP 1
          sm.ID, sm.NewDay, sm.UserID, sm.ShiftID,
          sm.StartDate, sm.StartTime, sm.EndDate, sm.EndTime, sm.Status,
          u.UserName,
          s.ShiftName
        FROM [dbo].[TblShiftMove] sm
        LEFT JOIN [dbo].[TblUser] u ON sm.UserID = u.UserID
        LEFT JOIN [dbo].[TblShift] s ON sm.ShiftID = s.ShiftID
        WHERE sm.Status = 1 AND sm.UserID = @userID
        ORDER BY sm.ID DESC
      `);
    const shift =
      shiftResult.recordset.length > 0 ? shiftResult.recordset[0] : null;

    const permissions = getPermissions(user.UserLevel);

    return NextResponse.json({ user, day, shift, permissions });
  } catch (err: unknown) {
    const rawMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[auth/session] GET error:", rawMessage);
    const userMessage = getUserFriendlyError(err);
    return NextResponse.json({ error: userMessage }, { status: 500 });
  }
}

// DELETE /api/auth/session — logout
export async function DELETE() {
  try {
    await destroySession();
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[auth/session] DELETE error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

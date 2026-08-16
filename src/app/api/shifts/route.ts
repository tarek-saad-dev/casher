import { NextRequest, NextResponse } from "next/server";
import { getPool, getUserFriendlyError } from "@/lib/db";
import sql from "mssql";
import { isActiveBranchContext, requireActiveBranchContext } from "@/lib/branch";

export const runtime = "nodejs";

/**
 * GET /api/shifts
 * Get shifts for a specific business day on the session active branch only.
 * Query params:
 * - newDay: business day date (required)
 */
export async function GET(request: NextRequest) {
  try {
    const branch = await requireActiveBranchContext();
    if (!isActiveBranchContext(branch)) return branch;

    const db = await getPool();

    const searchParams = request.nextUrl.searchParams;
    const newDay = searchParams.get("newDay") || null;

    if (newDay === null) {
      return NextResponse.json(
        { error: "معامل newDay مطلوب" },
        { status: 400 },
      );
    }

    const result = await db
      .request()
      .input("newDay", sql.Date, newDay)
      .input("branchId", sql.Int, branch.branchId)
      .query(`
        SELECT 
          sm.ID as ShiftMoveID,
          sm.ShiftID,
          s.ShiftName,
          sm.UserID,
          u.UserName,
          sm.StartDate,
          sm.EndDate
        FROM [dbo].[TblShiftMove] sm
        INNER JOIN [dbo].[TblShift] s ON sm.ShiftID = s.ShiftID
        INNER JOIN [dbo].[TblUser] u ON sm.UserID = u.UserID
        WHERE sm.NewDay = @newDay
          AND sm.BranchID = @branchId
        ORDER BY sm.StartDate DESC
      `);

    const shifts = result.recordset.map((row: {
      ShiftMoveID: number;
      ShiftID: number;
      ShiftName: string;
      UserID: number;
      UserName: string;
      StartDate: Date;
      EndDate: Date | null;
    }) => ({
      ShiftMoveID: row.ShiftMoveID,
      ShiftID: row.ShiftID,
      ShiftName: row.ShiftName,
      UserID: row.UserID,
      UserName: row.UserName,
      StartDate: row.StartDate,
      EndDate: row.EndDate,
    }));

    return NextResponse.json({ shifts });
  } catch (error) {
    console.error("[api/shifts] GET error:", error);
    return NextResponse.json(
      {
        error: "فشل تحميل الورديات",
        details: getUserFriendlyError(error),
      },
      { status: 500 },
    );
  }
}

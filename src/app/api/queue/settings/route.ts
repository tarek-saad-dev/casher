import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  requireActiveBranchContext,
  requireBranchOperationAccess,
  isActiveBranchContext,
} from "@/lib/branch/context";

export const runtime = "nodejs";

const DEFAULT_SETTINGS = {
  QueuePrefix: "A",
  QueueStartNumber: 1,
  ResetQueueDaily: true,
  DefaultServiceMinutes: 30,
  BookingGracePeriod: 15,
  AutoNoShowAfterMin: 30,
  AllowDoubleBooking: false,
  BookingPriorityMode: "fifo",
};

/**
 * Phase 1I: BranchID on QueueBookingSettings is required (Phase 1F).
 * Never fall back to an unscoped TOP 1 settings row.
 */
export async function GET() {
  try {
    const branch = await requireActiveBranchContext();
    if (!isActiveBranchContext(branch)) return branch;

    const db = await getPool();

    const tableCheck = await db.request().query(`
      SELECT 1 AS exists FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='QueueBookingSettings'
    `);
    if (!tableCheck.recordset.length) {
      console.warn("[queue settings GET] QueueBookingSettings table not found — returning defaults");
      return NextResponse.json({ settings: DEFAULT_SETTINGS });
    }

    const result = await db.request().input("branchId", sql.Int, branch.branchId).query(`
      SELECT TOP 1 * FROM [dbo].[QueueBookingSettings]
      WHERE BranchID = @branchId
      ORDER BY SettingID DESC
    `);

    if (!result.recordset.length) {
      await db.request().input("branchId", sql.Int, branch.branchId).query(`
        INSERT INTO [dbo].[QueueBookingSettings] (BranchID) VALUES (@branchId)
      `);
      return NextResponse.json({ settings: DEFAULT_SETTINGS });
    }

    return NextResponse.json({ settings: result.recordset[0] });
  } catch (err) {
    console.error("[queue settings GET]", err);
    return NextResponse.json({ settings: DEFAULT_SETTINGS });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const session = await getSession();
    const userID = session?.UserID ?? 0;
    const body = await req.json();

    const db = await getPool();

    const check = await db.request().input("branchId", sql.Int, branch.branchId).query(
      `SELECT TOP 1 SettingID FROM [dbo].[QueueBookingSettings] WHERE BranchID = @branchId`,
    );

    if (check.recordset.length === 0) {
      await db.request().input("branchId", sql.Int, branch.branchId).query(
        `INSERT INTO [dbo].[QueueBookingSettings] (BranchID) VALUES (@branchId)`,
      );
    }

    await db
      .request()
      .input("prefix", sql.NVarChar, body.QueuePrefix ?? "A")
      .input("startNum", sql.Int, body.QueueStartNumber ?? 1)
      .input("resetDaily", sql.Bit, body.ResetQueueDaily ?? 1)
      .input("defMins", sql.Int, body.DefaultServiceMinutes ?? 30)
      .input("grace", sql.Int, body.BookingGracePeriod ?? 15)
      .input("noShow", sql.Int, body.AutoNoShowAfterMin ?? 30)
      .input("doubleBook", sql.Bit, body.AllowDoubleBooking ?? 0)
      .input("prioMode", sql.NVarChar, body.BookingPriorityMode ?? "fifo")
      .input("userID", sql.Int, userID)
      .input("branchId", sql.Int, branch.branchId)
      .query(`
        UPDATE [dbo].[QueueBookingSettings]
        SET
          QueuePrefix           = @prefix,
          QueueStartNumber      = @startNum,
          ResetQueueDaily       = @resetDaily,
          DefaultServiceMinutes = @defMins,
          BookingGracePeriod    = @grace,
          AutoNoShowAfterMin    = @noShow,
          AllowDoubleBooking    = @doubleBook,
          BookingPriorityMode   = @prioMode,
          UpdatedAt             = GETDATE(),
          UpdatedByUserID       = @userID
        WHERE BranchID = @branchId
      `);

    const { invalidatePublicSettingsCache } = await import("@/lib/publicBookingHelpers");
    invalidatePublicSettingsCache(branch.branchId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[queue settings PATCH]", err);
    return NextResponse.json({ error: "فشل حفظ الإعدادات" }, { status: 500 });
  }
}

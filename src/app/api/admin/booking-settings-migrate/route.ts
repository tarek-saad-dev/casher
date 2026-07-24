/**
 * Admin API: Migrate/Seed QueueBookingSettings
 * GET: Check current settings
 * POST: Migrate/Update settings to target values
 *
 * Target values:
 * - SalonName = 'Cut Salon'
 * - Timezone = 'Africa/Cairo'
 * - Currency = 'EGP'
 * - BookingEnabled = 1
 * - AllowSpecificBarber = 1
 * - AllowNearestBarber = 1
 * - DefaultMode = 'nearest'
 * - SlotIntervalMinutes = 15
 * - MaxBookingDaysAhead = 14
 * - MinNoticeMinutes = 30
 */

import { NextResponse } from "next/server";
import { isAuthResult, requireDevelopmentAdmin } from '@/lib/api-auth';
import { getPool, sql } from "@/lib/db";
import {
  isActiveBranchContext,
  requireActiveBranchContext,
} from "@/lib/branch";

// Get column info for QueueBookingSettings
async function getColumnInfo(db: sql.ConnectionPool) {
  const result = await db.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'QueueBookingSettings'
    ORDER BY ORDINAL_POSITION
  `);
  return result.recordset;
}

// Check if table exists
async function tableExists(db: sql.ConnectionPool): Promise<boolean> {
  const result = await db.request().query(`
    SELECT COUNT(*) as count
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = 'QueueBookingSettings'
  `);
  return result.recordset[0].count > 0;
}

// Get current settings row for a specific branch (Phase 1I — never unscoped TOP 1)
async function getCurrentSettings(db: sql.ConnectionPool, branchId: number) {
  const result = await db
    .request()
    .input("branchId", sql.Int, branchId)
    .query(`
    SELECT TOP 1 *
    FROM [dbo].[QueueBookingSettings]
    WHERE BranchID = @branchId
    ORDER BY SettingID DESC
  `);
  return result.recordset[0] || null;
}

// Add column if it doesn't exist
async function addColumnIfNotExists(
  db: sql.ConnectionPool,
  columnName: string,
  dataType: string,
  defaultValue: string,
): Promise<boolean> {
  const checkResult = await db.request().query(`
    SELECT COUNT(*) as count
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'QueueBookingSettings' AND COLUMN_NAME = '${columnName}'
  `);

  if (checkResult.recordset[0].count === 0) {
    await db.request().query(`
      ALTER TABLE [dbo].[QueueBookingSettings]
      ADD ${columnName} ${dataType} ${defaultValue}
    `);
    return true;
  }
  return false;
}

// GET: Check current state
export async function GET() {
  const __auth = await requireDevelopmentAdmin();
  if (!isAuthResult(__auth)) return __auth;

  /* secret gate replaced by requireDevelopmentAdmin (Phase 1A) */

  try {
    const db = await getPool();

    // Check if table exists
    const exists = await tableExists(db);
    if (!exists) {
      return NextResponse.json(
        {
          ok: false,
          error: "Table QueueBookingSettings does not exist",
          tableExists: false,
        },
        { status: 404 },
      );
    }

    const branch = await requireActiveBranchContext();
    if (!isActiveBranchContext(branch)) return branch;

    // Get column info
    const columns = await getColumnInfo(db);

    // Get current settings for the active branch only (Phase 1I)
    const currentSettings = await getCurrentSettings(db, branch.branchId);

    return NextResponse.json({
      ok: true,
      tableExists: true,
      branchId: branch.branchId,
      branchCode: branch.branchCode,
      columns: columns.map((c) => ({
        name: c.COLUMN_NAME,
        type: c.DATA_TYPE,
        nullable: c.IS_NULLABLE,
      })),
      currentSettings,
      targetValues: {
        SalonName: "Cut Salon",
        Timezone: "Africa/Cairo",
        Currency: "EGP",
        BookingEnabled: 1,
        AllowSpecificBarber: 1,
        AllowNearestBarber: 1,
        DefaultMode: "nearest",
        SlotIntervalMinutes: 15,
        MaxBookingDaysAhead: 14,
        MinNoticeMinutes: 30,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error("[admin/booking-settings-migrate] GET error:", message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}

// POST: Run migration
export async function POST() {
  const __auth = await requireDevelopmentAdmin();
  if (!isAuthResult(__auth)) return __auth;

  /* secret gate replaced by requireDevelopmentAdmin (Phase 1A) */

  try {
    const branch = await requireActiveBranchContext();
    if (!isActiveBranchContext(branch)) return branch;
    const branchId = branch.branchId;

    const db = await getPool();
    const changes: string[] = [];

    // Check if table exists
    const exists = await tableExists(db);
    if (!exists) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "QueueBookingSettings missing — use Phase 1F/1G bootstrap; do not recreate without BranchID",
        },
        { status: 409 },
      );
    }

    {
      // Table exists - ensure all columns exist
      const addedCols: string[] = [];

      if (await addColumnIfNotExists(db, "LogoUrl", "NVARCHAR(500)", "NULL")) {
        addedCols.push("LogoUrl");
      }
      if (
        await addColumnIfNotExists(
          db,
          "Timezone",
          "NVARCHAR(100)",
          "NOT NULL DEFAULT N'Africa/Cairo'",
        )
      ) {
        addedCols.push("Timezone");
      }
      if (
        await addColumnIfNotExists(
          db,
          "Currency",
          "NVARCHAR(10)",
          "NOT NULL DEFAULT N'EGP'",
        )
      ) {
        addedCols.push("Currency");
      }
      if (
        await addColumnIfNotExists(
          db,
          "BookingEnabled",
          "BIT",
          "NOT NULL DEFAULT 1",
        )
      ) {
        addedCols.push("BookingEnabled");
      }
      if (
        await addColumnIfNotExists(
          db,
          "AllowSpecificBarber",
          "BIT",
          "NOT NULL DEFAULT 1",
        )
      ) {
        addedCols.push("AllowSpecificBarber");
      }
      if (
        await addColumnIfNotExists(
          db,
          "AllowNearestBarber",
          "BIT",
          "NOT NULL DEFAULT 1",
        )
      ) {
        addedCols.push("AllowNearestBarber");
      }
      if (
        await addColumnIfNotExists(
          db,
          "DefaultMode",
          "NVARCHAR(20)",
          "NOT NULL DEFAULT N'nearest'",
        )
      ) {
        addedCols.push("DefaultMode");
      }
      if (
        await addColumnIfNotExists(
          db,
          "SlotIntervalMinutes",
          "INT",
          "NOT NULL DEFAULT 15",
        )
      ) {
        addedCols.push("SlotIntervalMinutes");
      }
      if (
        await addColumnIfNotExists(
          db,
          "MaxBookingDaysAhead",
          "INT",
          "NOT NULL DEFAULT 14",
        )
      ) {
        addedCols.push("MaxBookingDaysAhead");
      }
      if (
        await addColumnIfNotExists(
          db,
          "MinNoticeMinutes",
          "INT",
          "NOT NULL DEFAULT 30",
        )
      ) {
        addedCols.push("MinNoticeMinutes");
      }
      if (
        await addColumnIfNotExists(
          db,
          "DefaultServiceDurationMinutes",
          "INT",
          "NULL",
        )
      ) {
        addedCols.push("DefaultServiceDurationMinutes");
      }
      if (
        await addColumnIfNotExists(db, "DefaultServiceMinutes", "INT", "NULL")
      ) {
        addedCols.push("DefaultServiceMinutes");
      }

      if (addedCols.length > 0) {
        changes.push(`Added columns: ${addedCols.join(", ")}`);
      }

      // Check if any row exists for this branch
      const currentRow = await getCurrentSettings(db, branchId);

      if (!currentRow) {
        await db.request().input("branchId", sql.Int, branchId).query(`
          INSERT INTO [dbo].[QueueBookingSettings] (
            BranchID, SalonName, Timezone, Currency, BookingEnabled,
            AllowSpecificBarber, AllowNearestBarber, DefaultMode,
            SlotIntervalMinutes, MaxBookingDaysAhead, MinNoticeMinutes
          ) VALUES (
            @branchId, N'Cut Salon', N'Africa/Cairo', N'EGP', 1,
            1, 1, N'nearest', 15, 14, 30
          )
        `);
        changes.push(`Inserted settings row for BranchID=${branchId}`);
      } else {
        await db.request().input("branchId", sql.Int, branchId).query(`
          UPDATE [dbo].[QueueBookingSettings]
          SET
            SalonName = N'Cut Salon',
            Timezone = N'Africa/Cairo',
            Currency = N'EGP',
            BookingEnabled = 1,
            AllowSpecificBarber = 1,
            AllowNearestBarber = 1,
            DefaultMode = N'nearest',
            SlotIntervalMinutes = 15,
            MaxBookingDaysAhead = 14,
            MinNoticeMinutes = 30,
            UpdatedAt = GETDATE()
          WHERE BranchID = @branchId
        `);
        changes.push(`Updated settings for BranchID=${branchId}`);
      }
    }

    // Verify the update
    const verifySettings = await getCurrentSettings(db, branchId);

    return NextResponse.json({
      ok: true,
      branchId,
      branchCode: branch.branchCode,
      changes,
      verifiedSettings: verifySettings,
      bookingEnabled:
        verifySettings?.BookingEnabled === 1 ||
        verifySettings?.BookingEnabled === true,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const details = err instanceof Error ? err.stack : undefined;
    console.error("[admin/booking-settings-migrate] POST error:", message);
    return NextResponse.json(
      { ok: false, error: message, details },
      { status: 500 },
    );
  }
}

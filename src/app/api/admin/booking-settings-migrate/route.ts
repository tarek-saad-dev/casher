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

import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";

// Simple auth check - requires admin session or secret key
function isAuthorized(req: NextRequest): boolean {
  const secretKey = req.headers.get("x-admin-secret");
  const adminKey = process.env.ADMIN_SECRET_KEY || "admin-secret-change-me";
  return secretKey === adminKey;
}

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

// Get current settings row
async function getCurrentSettings(db: sql.ConnectionPool) {
  const result = await db.request().query(`
    SELECT TOP 1 *
    FROM [dbo].[QueueBookingSettings]
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
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

    // Get column info
    const columns = await getColumnInfo(db);

    // Get current settings
    const currentSettings = await getCurrentSettings(db);

    return NextResponse.json({
      ok: true,
      tableExists: true,
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
  } catch (err: any) {
    console.error("[admin/booking-settings-migrate] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 },
    );
  }
}

// POST: Run migration
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = await getPool();
    const changes: string[] = [];

    // Check if table exists
    const exists = await tableExists(db);
    if (!exists) {
      // Create table
      await db.request().query(`
        CREATE TABLE [dbo].[QueueBookingSettings] (
          SettingID INT PRIMARY KEY IDENTITY(1,1),
          SalonName NVARCHAR(200) NOT NULL DEFAULT N'Cut Salon',
          LogoUrl NVARCHAR(500) NULL,
          Timezone NVARCHAR(100) NOT NULL DEFAULT N'Africa/Cairo',
          Currency NVARCHAR(10) NOT NULL DEFAULT N'EGP',
          BookingEnabled BIT NOT NULL DEFAULT 1,
          AllowSpecificBarber BIT NOT NULL DEFAULT 1,
          AllowNearestBarber BIT NOT NULL DEFAULT 1,
          DefaultMode NVARCHAR(20) NOT NULL DEFAULT N'nearest',
          SlotIntervalMinutes INT NOT NULL DEFAULT 15,
          MaxBookingDaysAhead INT NOT NULL DEFAULT 14,
          MinNoticeMinutes INT NOT NULL DEFAULT 30,
          DefaultServiceDurationMinutes INT NULL,
          DefaultServiceMinutes INT NULL,
          CreatedAt DATETIME2 DEFAULT GETDATE(),
          UpdatedAt DATETIME2 DEFAULT GETDATE()
        )
      `);
      changes.push("Created table QueueBookingSettings");

      // Insert default row
      await db.request().query(`
        INSERT INTO [dbo].[QueueBookingSettings] (
          SalonName, Timezone, Currency, BookingEnabled,
          AllowSpecificBarber, AllowNearestBarber, DefaultMode,
          SlotIntervalMinutes, MaxBookingDaysAhead, MinNoticeMinutes
        ) VALUES (
          N'Cut Salon', N'Africa/Cairo', N'EGP', 1,
          1, 1, N'nearest', 15, 14, 30
        )
      `);
      changes.push("Inserted default settings row");
    } else {
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

      // Check if any row exists
      const currentRow = await getCurrentSettings(db);

      if (!currentRow) {
        // Insert new row with target values
        await db.request().query(`
          INSERT INTO [dbo].[QueueBookingSettings] (
            SalonName, Timezone, Currency, BookingEnabled,
            AllowSpecificBarber, AllowNearestBarber, DefaultMode,
            SlotIntervalMinutes, MaxBookingDaysAhead, MinNoticeMinutes
          ) VALUES (
            N'Cut Salon', N'Africa/Cairo', N'EGP', 1,
            1, 1, N'nearest', 15, 14, 30
          )
        `);
        changes.push("Inserted settings row with target values");
      } else {
        // Update existing row to target values
        await db.request().query(`
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
          WHERE SettingID = (SELECT TOP 1 SettingID FROM [dbo].[QueueBookingSettings])
        `);
        changes.push("Updated existing settings row to target values");
      }
    }

    // Verify the update
    const verifySettings = await getCurrentSettings(db);

    return NextResponse.json({
      ok: true,
      changes,
      verifiedSettings: verifySettings,
      bookingEnabled:
        verifySettings?.BookingEnabled === 1 ||
        verifySettings?.BookingEnabled === true,
    });
  } catch (err: any) {
    console.error("[admin/booking-settings-migrate] POST error:", err);
    return NextResponse.json(
      { ok: false, error: err.message, details: err.stack },
      { status: 500 },
    );
  }
}

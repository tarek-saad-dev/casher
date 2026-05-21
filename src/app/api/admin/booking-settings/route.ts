import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

// Default settings matching the existing system
const DEFAULT_SETTINGS = {
  SalonName: "Cut Salon",
  Timezone: "Africa/Cairo",
  Currency: "EGP",
  BookingEnabled: true,
  AllowSpecificBarber: true,
  AllowNearestBarber: true,
  DefaultMode: "nearest",
  SlotIntervalMinutes: 15,
  MinNoticeMinutes: 30,
  MaxBookingDaysAhead: 14,
  DefaultServiceDurationMinutes: 30,
};

// Helper to ensure table and columns exist
async function ensureTableAndColumns(db: sql.ConnectionPool) {
  // Check if table exists
  const tableCheck = await db.request().query(`
    SELECT COUNT(*) as count
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'QueueBookingSettings'
  `);

  if (tableCheck.recordset[0].count === 0) {
    // Create table with all required columns
    await db.request().query(`
      CREATE TABLE [dbo].[QueueBookingSettings] (
        SettingID INT PRIMARY KEY IDENTITY(1,1),
        SalonName NVARCHAR(200) NOT NULL DEFAULT N'Cut Salon',
        Timezone NVARCHAR(100) NOT NULL DEFAULT N'Africa/Cairo',
        Currency NVARCHAR(10) NOT NULL DEFAULT N'EGP',
        BookingEnabled BIT NOT NULL DEFAULT 1,
        AllowSpecificBarber BIT NOT NULL DEFAULT 1,
        AllowNearestBarber BIT NOT NULL DEFAULT 1,
        DefaultMode NVARCHAR(20) NOT NULL DEFAULT N'nearest',
        SlotIntervalMinutes INT NOT NULL DEFAULT 15,
        MinNoticeMinutes INT NOT NULL DEFAULT 30,
        MaxBookingDaysAhead INT NOT NULL DEFAULT 14,
        DefaultServiceDurationMinutes INT NULL,
        DefaultServiceMinutes INT NULL,
        CreatedAt DATETIME2 DEFAULT GETDATE(),
        UpdatedAt DATETIME2 DEFAULT GETDATE()
      )
    `);

    // Insert default row
    await db.request().query(`
      INSERT INTO [dbo].[QueueBookingSettings] (
        SalonName, Timezone, Currency, BookingEnabled,
        AllowSpecificBarber, AllowNearestBarber, DefaultMode,
        SlotIntervalMinutes, MinNoticeMinutes, MaxBookingDaysAhead,
        DefaultServiceDurationMinutes
      ) VALUES (
        N'Cut Salon', N'Africa/Cairo', N'EGP', 1,
        1, 1, N'nearest', 15, 30, 14, 30
      )
    `);

    return { created: true };
  }

  // Ensure all columns exist
  const columnsToAdd = [
    { name: "BookingEnabled", type: "BIT", default: "DEFAULT 1" },
    { name: "AllowSpecificBarber", type: "BIT", default: "DEFAULT 1" },
    { name: "AllowNearestBarber", type: "BIT", default: "DEFAULT 1" },
    {
      name: "DefaultMode",
      type: "NVARCHAR(20)",
      default: "DEFAULT N'nearest'",
    },
    { name: "SlotIntervalMinutes", type: "INT", default: "DEFAULT 15" },
    { name: "MinNoticeMinutes", type: "INT", default: "DEFAULT 30" },
    { name: "MaxBookingDaysAhead", type: "INT", default: "DEFAULT 14" },
    { name: "DefaultServiceDurationMinutes", type: "INT", default: "NULL" },
    {
      name: "Timezone",
      type: "NVARCHAR(100)",
      default: "DEFAULT N'Africa/Cairo'",
    },
    { name: "Currency", type: "NVARCHAR(10)", default: "DEFAULT N'EGP'" },
    {
      name: "SalonName",
      type: "NVARCHAR(200)",
      default: "DEFAULT N'Cut Salon'",
    },
  ];

  const added: string[] = [];

  for (const col of columnsToAdd) {
    const colCheck = await db.request().query(`
      SELECT COUNT(*) as count
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = 'QueueBookingSettings'
        AND COLUMN_NAME = '${col.name}'
    `);

    if (colCheck.recordset[0].count === 0) {
      await db.request().query(`
        ALTER TABLE [dbo].[QueueBookingSettings]
        ADD ${col.name} ${col.type} ${col.default}
      `);
      added.push(col.name);
    }
  }

  // Ensure at least one row exists
  const rowCheck = await db.request().query(`
    SELECT COUNT(*) as count FROM [dbo].[QueueBookingSettings]
  `);

  if (rowCheck.recordset[0].count === 0) {
    await db.request().query(`
      INSERT INTO [dbo].[QueueBookingSettings] (
        SalonName, Timezone, Currency, BookingEnabled,
        AllowSpecificBarber, AllowNearestBarber, DefaultMode,
        SlotIntervalMinutes, MinNoticeMinutes, MaxBookingDaysAhead,
        DefaultServiceDurationMinutes
      ) VALUES (
        N'Cut Salon', N'Africa/Cairo', N'EGP', 1,
        1, 1, N'nearest', 15, 30, 14, 30
      )
    `);
  }

  return { created: false, added };
}

// GET: Retrieve booking settings
export async function GET() {
  try {
    const session = await getSession();
    if (!session?.UserID) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const db = await getPool();
    await ensureTableAndColumns(db);

    const result = await db.request().query(`
      SELECT TOP 1
        SalonName,
        Timezone,
        Currency,
        BookingEnabled,
        AllowSpecificBarber,
        AllowNearestBarber,
        DefaultMode,
        SlotIntervalMinutes,
        MinNoticeMinutes,
        MaxBookingDaysAhead,
        DefaultServiceDurationMinutes,
        DefaultServiceMinutes
      FROM [dbo].[QueueBookingSettings]
    `);

    const row = result.recordset[0] || DEFAULT_SETTINGS;

    return NextResponse.json({
      ok: true,
      settings: {
        salonName: row.SalonName || DEFAULT_SETTINGS.SalonName,
        timezone: row.Timezone || DEFAULT_SETTINGS.Timezone,
        currency: row.Currency || DEFAULT_SETTINGS.Currency,
        bookingEnabled: row.BookingEnabled ?? DEFAULT_SETTINGS.BookingEnabled,
        allowSpecificBarber:
          row.AllowSpecificBarber ?? DEFAULT_SETTINGS.AllowSpecificBarber,
        allowNearestBarber:
          row.AllowNearestBarber ?? DEFAULT_SETTINGS.AllowNearestBarber,
        defaultMode: row.DefaultMode || DEFAULT_SETTINGS.DefaultMode,
        slotIntervalMinutes:
          row.SlotIntervalMinutes ?? DEFAULT_SETTINGS.SlotIntervalMinutes,
        minNoticeMinutes:
          row.MinNoticeMinutes ?? DEFAULT_SETTINGS.MinNoticeMinutes,
        maxBookingDaysAhead:
          row.MaxBookingDaysAhead ?? DEFAULT_SETTINGS.MaxBookingDaysAhead,
        defaultServiceDurationMinutes:
          row.DefaultServiceDurationMinutes ??
          row.DefaultServiceMinutes ??
          DEFAULT_SETTINGS.DefaultServiceDurationMinutes,
      },
    });
  } catch (err) {
    console.error("[admin/booking-settings GET]", err);
    return NextResponse.json(
      { ok: false, error: "فشل تحميل الإعدادات" },
      { status: 500 },
    );
  }
}

// PATCH: Update booking settings
export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.UserID) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const body = await request.json();
    const db = await getPool();
    await ensureTableAndColumns(db);

    // Validation helpers
    const validModes = ["nearest", "specific"];
    const validMinNotice = [0, 5, 10, 15, 30, 60];
    const validSlotInterval = [5, 10, 15, 30];

    // Validate values
    if (
      body.minNoticeMinutes !== undefined &&
      !validMinNotice.includes(body.minNoticeMinutes)
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "قيمة MinNoticeMinutes غير صالحة. القيم المسموحة: 0, 5, 10, 15, 30, 60",
        },
        { status: 400 },
      );
    }

    if (
      body.slotIntervalMinutes !== undefined &&
      !validSlotInterval.includes(body.slotIntervalMinutes)
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "قيمة SlotIntervalMinutes غير صالحة. القيم المسموحة: 5, 10, 15, 30",
        },
        { status: 400 },
      );
    }

    if (
      body.maxBookingDaysAhead !== undefined &&
      (body.maxBookingDaysAhead < 1 || body.maxBookingDaysAhead > 60)
    ) {
      return NextResponse.json(
        { ok: false, error: "قيمة MaxBookingDaysAhead يجب أن تكون بين 1 و 60" },
        { status: 400 },
      );
    }

    if (
      body.defaultMode !== undefined &&
      !validModes.includes(body.defaultMode)
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "قيمة DefaultMode يجب أن تكون nearest أو specific",
        },
        { status: 400 },
      );
    }

    // Build update query dynamically
    const updates: string[] = [];
    const req = db.request();

    if (body.salonName !== undefined) {
      updates.push("SalonName = @salonName");
      req.input(
        "salonName",
        sql.NVarChar,
        String(body.salonName).slice(0, 200),
      );
    }

    if (body.timezone !== undefined) {
      updates.push("Timezone = @timezone");
      req.input("timezone", sql.NVarChar, String(body.timezone).slice(0, 100));
    }

    if (body.currency !== undefined) {
      updates.push("Currency = @currency");
      req.input("currency", sql.NVarChar, String(body.currency).slice(0, 10));
    }

    if (body.bookingEnabled !== undefined) {
      updates.push("BookingEnabled = @bookingEnabled");
      req.input("bookingEnabled", sql.Bit, !!body.bookingEnabled);
    }

    if (body.allowSpecificBarber !== undefined) {
      updates.push("AllowSpecificBarber = @allowSpecificBarber");
      req.input("allowSpecificBarber", sql.Bit, !!body.allowSpecificBarber);
    }

    if (body.allowNearestBarber !== undefined) {
      updates.push("AllowNearestBarber = @allowNearestBarber");
      req.input("allowNearestBarber", sql.Bit, !!body.allowNearestBarber);
    }

    if (body.defaultMode !== undefined) {
      updates.push("DefaultMode = @defaultMode");
      req.input("defaultMode", sql.NVarChar(20), body.defaultMode);
    }

    if (body.slotIntervalMinutes !== undefined) {
      updates.push("SlotIntervalMinutes = @slotIntervalMinutes");
      req.input("slotIntervalMinutes", sql.Int, body.slotIntervalMinutes);
    }

    if (body.minNoticeMinutes !== undefined) {
      updates.push("MinNoticeMinutes = @minNoticeMinutes");
      req.input("minNoticeMinutes", sql.Int, body.minNoticeMinutes);
    }

    if (body.maxBookingDaysAhead !== undefined) {
      updates.push("MaxBookingDaysAhead = @maxBookingDaysAhead");
      req.input("maxBookingDaysAhead", sql.Int, body.maxBookingDaysAhead);
    }

    if (body.defaultServiceDurationMinutes !== undefined) {
      updates.push(
        "DefaultServiceDurationMinutes = @defaultServiceDurationMinutes",
      );
      req.input(
        "defaultServiceDurationMinutes",
        sql.Int,
        body.defaultServiceDurationMinutes,
      );
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { ok: false, error: "لا يوجد إعدادات للتحديث" },
        { status: 400 },
      );
    }

    // Add UpdatedAt
    updates.push("UpdatedAt = GETDATE()");

    await req.query(`
      UPDATE [dbo].[QueueBookingSettings]
      SET ${updates.join(", ")}
    `);

    return NextResponse.json({
      ok: true,
      message: "تم حفظ الإعدادات بنجاح",
    });
  } catch (err) {
    console.error("[admin/booking-settings PATCH]", err);
    return NextResponse.json(
      { ok: false, error: "فشل حفظ الإعدادات" },
      { status: 500 },
    );
  }
}

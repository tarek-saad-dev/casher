import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import {
  requireActiveBranchContext,
  requireBranchOperationAccess,
  isActiveBranchContext,
} from "@/lib/branch/context";
import { bookingSettingsValidationError } from "@/lib/booking/bookingSettingsValidation";
import { bookingDefaultsForBranch } from "@/lib/booking/bookingBranchDefaults";
import { getBranchById } from "@/lib/branch/repository";

export const runtime = "nodejs";

// Helper to ensure table and columns exist (schema-level only — never seeds an
// unscoped row; per-branch rows are lazily inserted by ensureBranchSettingsRow).
async function ensureTableAndColumns(db: sql.ConnectionPool) {
  // Check if table exists
  const tableCheck = await db.request().query(`
    SELECT COUNT(*) as count
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'QueueBookingSettings'
  `);

  if (tableCheck.recordset[0].count === 0) {
    // Create table with all required columns (BranchID is required — Phase 1G
    // never creates branch-less settings rows).
    await db.request().query(`
      CREATE TABLE [dbo].[QueueBookingSettings] (
        SettingID INT PRIMARY KEY IDENTITY(1,1),
        BranchID INT NOT NULL,
        SalonName NVARCHAR(200) NOT NULL DEFAULT N'الفرع الرئيسي',
        Timezone NVARCHAR(100) NOT NULL DEFAULT N'Africa/Cairo',
        Currency NVARCHAR(10) NOT NULL DEFAULT N'EGP',
        BookingEnabled BIT NOT NULL DEFAULT 0,
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
      default: "DEFAULT N'الفرع الرئيسي'",
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

  return { created: false, added };
}

/** Lazily insert a scoped default settings row for this branch only (idempotent). */
async function ensureBranchSettingsRow(
  db: sql.ConnectionPool,
  branch: { branchId: number; branchName: string; timeZone: string },
) {
  const defaults = bookingDefaultsForBranch(branch);
  // One atomic, branch-scoped seed. No cross-tenant template, no automatic public launch.
  await db
    .request()
    .input("branchId", sql.Int, branch.branchId)
    .input("salonName", sql.NVarChar(200), defaults.SalonName)
    .input("timezone", sql.NVarChar(100), defaults.Timezone)
    .input("currency", sql.NVarChar(10), defaults.Currency)
    .input("bookingEnabled", sql.Bit, defaults.BookingEnabled ? 1 : 0)
    .input("defaultMode", sql.NVarChar(20), defaults.DefaultMode)
    .input("slot", sql.Int, defaults.SlotIntervalMinutes)
    .input("notice", sql.Int, defaults.MinNoticeMinutes)
    .input("horizon", sql.Int, defaults.MaxBookingDaysAhead)
    .input("duration", sql.Int, defaults.DefaultServiceDurationMinutes)
    .query(`
      IF NOT EXISTS (
        SELECT 1 FROM dbo.QueueBookingSettings WITH (UPDLOCK, HOLDLOCK)
        WHERE BranchID = @branchId
      )
      BEGIN
        INSERT INTO dbo.QueueBookingSettings (
          BranchID, SalonName, Timezone, Currency, BookingEnabled,
          AllowSpecificBarber, AllowNearestBarber, DefaultMode,
          SlotIntervalMinutes, MinNoticeMinutes, MaxBookingDaysAhead,
          DefaultServiceDurationMinutes, DefaultServiceMinutes
        ) VALUES (
          @branchId, @salonName, @timezone, @currency, @bookingEnabled,
          1, 1, @defaultMode,
          @slot, @notice, @horizon, @duration, @duration
        );
      END
    `);
}

// GET: Retrieve booking settings for the caller's active branch
export async function GET() {
  try {
    const branch = await requireActiveBranchContext();
    if (!isActiveBranchContext(branch)) return branch;

    const db = await getPool();
    await ensureTableAndColumns(db);
    await ensureBranchSettingsRow(db, branch);

    const result = await db
      .request()
      .input("branchId", sql.Int, branch.branchId)
      .query(`
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
      WHERE BranchID = @branchId
    `);

    const defaults = bookingDefaultsForBranch(branch);
    const row = result.recordset[0] || defaults;
    const branchDetails = await getBranchById(branch.branchId);

    return NextResponse.json({
      ok: true,
      branch: {
        branchId: branch.branchId,
        branchCode: branch.branchCode,
        branchName: branch.branchName,
        lifecycleStatus: branchDetails?.lifecycleStatus ?? 'SETUP',
        publicBookingEnabled: branchDetails?.publicBookingEnabled ?? false,
        defaultOpenTime: branchDetails?.defaultOpenTime ?? null,
        defaultCloseTime: branchDetails?.defaultCloseTime ?? null,
      },
      settings: {
        salonName: row.SalonName || defaults.SalonName,
        timezone: row.Timezone || defaults.Timezone,
        currency: row.Currency || defaults.Currency,
        bookingEnabled: row.BookingEnabled ?? defaults.BookingEnabled,
        allowSpecificBarber:
          row.AllowSpecificBarber ?? defaults.AllowSpecificBarber,
        allowNearestBarber:
          row.AllowNearestBarber ?? defaults.AllowNearestBarber,
        defaultMode: row.DefaultMode || defaults.DefaultMode,
        slotIntervalMinutes:
          row.SlotIntervalMinutes ?? defaults.SlotIntervalMinutes,
        minNoticeMinutes:
          row.MinNoticeMinutes ?? defaults.MinNoticeMinutes,
        maxBookingDaysAhead:
          row.MaxBookingDaysAhead ?? defaults.MaxBookingDaysAhead,
        defaultServiceDurationMinutes:
          row.DefaultServiceDurationMinutes ??
          row.DefaultServiceMinutes ??
          defaults.DefaultServiceDurationMinutes,
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

// PATCH: Update booking settings for the caller's active branch
export async function PATCH(request: NextRequest) {
  try {
    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const body = await request.json();
    const db = await getPool();
    await ensureTableAndColumns(db);
    await ensureBranchSettingsRow(db, branch.branchId);

    const validationError = bookingSettingsValidationError(body);
    if (validationError) {
      return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
    }

    // Build update query dynamically — scoped to the caller's active branch
    const updates: string[] = [];
    const req = db.request().input("branchId", sql.Int, branch.branchId);

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
      WHERE BranchID = @branchId
    `);

    const { invalidatePublicSettingsCache } = await import("@/lib/publicBookingHelpers");
    invalidatePublicSettingsCache(branch.branchId);

    return NextResponse.json({
      ok: true,
      message: "تم حفظ الإعدادات بنجاح",
      ...(body.bookingEnabled !== undefined
        ? { bookingEnabled: !!body.bookingEnabled }
        : {}),
    });
  } catch (err) {
    console.error("[admin/booking-settings PATCH]", err);
    return NextResponse.json(
      { ok: false, error: "فشل حفظ الإعدادات" },
      { status: 500 },
    );
  }
}

/**
 * Admin API: Migrate Bookings Table - Add BookingCode column and index
 *
 * GET: Check current Bookings table schema
 * POST: Add BookingCode column and unique index if missing
 */

import { NextRequest, NextResponse } from "next/server";
import { isAuthResult, requireDevelopmentAdmin } from '@/lib/api-auth';
import { getPool, sql } from "@/lib/db";

// Simple auth check
function isAuthorized(req: NextRequest): boolean {
  const secretKey = req.headers.get("x-admin-secret");
  const adminKey = process.env.ADMIN_SECRET_KEY;
  return Boolean(adminKey) && secretKey === adminKey;
}

// Check if column exists
async function columnExists(
  db: sql.ConnectionPool,
  tableName: string,
  columnName: string
): Promise<boolean> {
  const result = await db.request().query(`
    SELECT COUNT(*) as count
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = '${tableName}' AND COLUMN_NAME = '${columnName}'
  `);
  return result.recordset[0].count > 0;
}

// Check if index exists
async function indexExists(
  db: sql.ConnectionPool,
  tableName: string,
  indexName: string
): Promise<boolean> {
  const result = await db.request().query(`
    SELECT COUNT(*) as count
    FROM sys.indexes
    WHERE name = '${indexName}'
      AND object_id = OBJECT_ID('dbo.${tableName}')
  `);
  return result.recordset[0].count > 0;
}

// GET: Check current schema
export async function GET(req: NextRequest) {
  const __auth = await requireDevelopmentAdmin();
  if (!isAuthResult(__auth)) return __auth;

  /* secret gate replaced by requireDevelopmentAdmin (Phase 1A) */

  try {
    const db = await getPool();

    // Check table exists
    const tableCheck = await db.request().query(`
      SELECT COUNT(*) as count
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME = 'Bookings'
    `);
    const tableExists = tableCheck.recordset[0].count > 0;

    if (!tableExists) {
      return NextResponse.json(
        { ok: false, error: "Bookings table does not exist" },
        { status: 404 }
      );
    }

    // Get columns
    const columnsRes = await db.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'Bookings'
      ORDER BY ORDINAL_POSITION
    `);

    // Check BookingCode specifically
    const bookingCodeExists = await columnExists(db, "Bookings", "BookingCode");

    // Check index
    const indexExistsResult = bookingCodeExists
      ? await indexExists(db, "Bookings", "UX_Bookings_BookingCode")
      : false;

    // Sample some existing codes
    let sampleCodes: string[] = [];
    if (bookingCodeExists) {
      const sampleRes = await db.request().query(`
        SELECT TOP 5 BookingCode
        FROM [dbo].[Bookings]
        WHERE BookingCode IS NOT NULL
        ORDER BY BookingID DESC
      `).catch(() => ({ recordset: [] }));
      sampleCodes = sampleRes.recordset.map((r: any) => r.BookingCode);
    }

    return NextResponse.json({
      ok: true,
      tableExists: true,
      columns: columnsRes.recordset.map((c) => ({
        name: c.COLUMN_NAME,
        type: c.DATA_TYPE,
        nullable: c.IS_NULLABLE,
        maxLength: c.CHARACTER_MAXIMUM_LENGTH,
      })),
      bookingCodeColumn: {
        exists: bookingCodeExists,
        indexExists: indexExistsResult,
      },
      sampleBookingCodes: sampleCodes,
      migrationNeeded: !bookingCodeExists || !indexExistsResult,
    });
  } catch (err: any) {
    console.error("[admin/bookings-migrate] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}

// POST: Run migration
export async function POST(req: NextRequest) {
  const __auth = await requireDevelopmentAdmin();
  if (!isAuthResult(__auth)) return __auth;

  /* secret gate replaced by requireDevelopmentAdmin (Phase 1A) */

  try {
    const db = await getPool();
    const changes: string[] = [];

    // 1. Add BookingCode column if missing
    const hasBookingCode = await columnExists(db, "Bookings", "BookingCode");
    if (!hasBookingCode) {
      await db.request().query(`
        ALTER TABLE [dbo].[Bookings]
        ADD BookingCode NVARCHAR(30) NULL
      `);
      changes.push("Added BookingCode NVARCHAR(30) NULL column");
    } else {
      changes.push("BookingCode column already exists");
    }

    // 2. Add unique filtered index if missing
    const hasIndex = await indexExists(db, "Bookings", "UX_Bookings_BookingCode");
    if (!hasIndex) {
      await db.request().query(`
        CREATE UNIQUE INDEX UX_Bookings_BookingCode
        ON [dbo].[Bookings] (BookingCode)
        WHERE BookingCode IS NOT NULL
      `);
      changes.push("Created unique filtered index UX_Bookings_BookingCode");
    } else {
      changes.push("Unique index already exists");
    }

    // 3. Backfill any existing bookings without a code (optional, for completeness)
    // This generates codes for existing bookings that don't have one
    const backfillRes = await db.request().query(`
      SELECT BookingID
      FROM [dbo].[Bookings]
      WHERE BookingCode IS NULL
    `).catch(() => ({ recordset: [] }));

    let backfilledCount = 0;
    for (const row of backfillRes.recordset) {
      const code = generateBookingCode();
      try {
        await db.request()
          .input("id", sql.Int, row.BookingID)
          .input("code", sql.NVarChar, code)
          .query(`
            UPDATE [dbo].[Bookings]
            SET BookingCode = @code
            WHERE BookingID = @id AND BookingCode IS NULL
          `);
        backfilledCount++;
      } catch {
        // Retry once with different code if collision
        const code2 = generateBookingCode();
        await db.request()
          .input("id", sql.Int, row.BookingID)
          .input("code", sql.NVarChar, code2)
          .query(`
            UPDATE [dbo].[Bookings]
            SET BookingCode = @code
            WHERE BookingID = @id AND BookingCode IS NULL
          `).catch(() => {});
        backfilledCount++;
      }
    }

    if (backfilledCount > 0) {
      changes.push(`Backfilled ${backfilledCount} existing bookings with new codes`);
    }

    // Verify
    const verify = await db.request().query(`
      SELECT COUNT(*) as total,
             COUNT(BookingCode) as withCode,
             COUNT(*) - COUNT(BookingCode) as withoutCode
      FROM [dbo].[Bookings]
    `);

    return NextResponse.json({
      ok: true,
      changes,
      stats: verify.recordset[0],
      verified: true,
    });
  } catch (err: any) {
    console.error("[admin/bookings-migrate] POST error:", err);
    return NextResponse.json(
      { ok: false, error: err.message, details: err.stack },
      { status: 500 }
    );
  }
}

// Generate a short human-readable booking code, e.g. "BK-A3X9"
function generateBookingCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "BK-";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * POST /api/admin/migrate-booking-announce
 * Safe migration: adds AnnouncedAt + CalledAt columns to dbo.Bookings if not exist.
 * Idempotent — safe to run multiple times.
 */
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";

export async function POST() {
  try {
    const db = await getPool();

    const results: string[] = [];

    // Add AnnouncedAt if not exists
    const r1 = await db.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('dbo.Bookings') AND name = 'AnnouncedAt'
      )
      BEGIN
        ALTER TABLE dbo.Bookings ADD AnnouncedAt datetime NULL;
        SELECT 'AnnouncedAt added' AS result;
      END
      ELSE
        SELECT 'AnnouncedAt already exists' AS result;
    `);
    results.push(r1.recordset[0]?.result ?? 'unknown');

    // Add CalledAt if not exists
    const r2 = await db.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('dbo.Bookings') AND name = 'CalledAt'
      )
      BEGIN
        ALTER TABLE dbo.Bookings ADD CalledAt datetime NULL;
        SELECT 'CalledAt added' AS result;
      END
      ELSE
        SELECT 'CalledAt already exists' AS result;
    `);
    results.push(r2.recordset[0]?.result ?? 'unknown');

    return NextResponse.json({ ok: true, results });
  } catch (err) {
    console.error("[migrate-booking-announce]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

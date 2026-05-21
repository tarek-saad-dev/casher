/**
 * publicBookingHelpers.ts
 *
 * Shared utilities for the public booking API:
 *   - Rate limiting (in-memory, per IP)
 *   - Input validation
 *   - Booking code generator
 *   - Customer upsert
 *   - Public settings loader
 */

import { getPool, sql } from "@/lib/db";
import { NextRequest } from "next/server";

// ── Rate limiting ─────────────────────────────────────────────────────────────

const ipHits = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_MAX = 60; // requests per minute per IP

export function getRateLimitKey(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

/** Returns true if the request is allowed, false if rate-limited */
export function checkRateLimit(ip: string, max = RATE_MAX): boolean {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now > entry.resetAt) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  entry.count++;
  if (entry.count > max) return false;
  return true;
}

// ── Booking code generator ────────────────────────────────────────────────────

/** Generate a short human-readable booking code, e.g. "BK-A3X9" */
export function generateBookingCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "BK-";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ── Input validation ──────────────────────────────────────────────────────────

/** Validate phone — must be at least 8 digits */
export function isValidPhone(phone: string): boolean {
  return /^[\d+\s\-]{8,20}$/.test(phone.trim());
}

export function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

export function isValidTime(s: string): boolean {
  return /^\d{2}:\d{2}$/.test(s);
}

// ── Public settings ───────────────────────────────────────────────────────────

export interface PublicSettings {
  salonName: string;
  timezone: string;
  currency: string;
  bookingEnabled: boolean;
  allowSpecificBarber: boolean;
  allowNearestBarber: boolean;
  defaultMode: "nearest" | "specific";
  slotIntervalMinutes: number;
  maxBookingDaysAhead: number;
  minNoticeMinutes: number;
  defaultServiceDurationMinutes: number;
}

export async function getPublicSettings(): Promise<PublicSettings> {
  try {
    const db = await getPool();
    const res = await db
      .request()
      .query(
        `
      SELECT TOP 1
        ISNULL(SalonName, N'Cut Salon') AS SalonName,
        ISNULL(Timezone, N'Africa/Cairo') AS Timezone,
        ISNULL(Currency, N'EGP') AS Currency,
        ISNULL(BookingEnabled, 1) AS BookingEnabled,
        ISNULL(AllowSpecificBarber, 1) AS AllowSpecificBarber,
        ISNULL(AllowNearestBarber, 1) AS AllowNearestBarber,
        ISNULL(DefaultMode, N'nearest') AS DefaultMode,
        ISNULL(SlotIntervalMinutes, 15) AS SlotIntervalMinutes,
        ISNULL(MaxBookingDaysAhead, 14) AS MaxBookingDaysAhead,
        ISNULL(MinNoticeMinutes, 30) AS MinNoticeMinutes,
        ISNULL(DefaultServiceDurationMinutes, ISNULL(DefaultServiceMinutes, 30)) AS DefaultServiceDurationMinutes
      FROM [dbo].[QueueBookingSettings]
    `,
      )
      .catch(() => ({ recordset: [] as any[] }));

    const row = res.recordset[0];
    // If no row exists, use fallback defaults
    if (!row) {
      return {
        salonName: "Cut Salon",
        timezone: "Africa/Cairo",
        currency: "EGP",
        bookingEnabled: true,
        allowSpecificBarber: true,
        allowNearestBarber: true,
        defaultMode: "nearest",
        slotIntervalMinutes: 15,
        maxBookingDaysAhead: 14,
        minNoticeMinutes: 30,
        defaultServiceDurationMinutes: 30,
      };
    }

    // Row exists - use DB values (ISNULL already handles NULL in SQL)
    return {
      salonName: row.SalonName,
      timezone: row.Timezone,
      currency: row.Currency,
      bookingEnabled: row.BookingEnabled !== 0,
      allowSpecificBarber: row.AllowSpecificBarber !== 0,
      allowNearestBarber: row.AllowNearestBarber !== 0,
      defaultMode: row.DefaultMode === "specific" ? "specific" : "nearest",
      slotIntervalMinutes: Number(row.SlotIntervalMinutes) || 15,
      maxBookingDaysAhead: Number(row.MaxBookingDaysAhead) || 14,
      minNoticeMinutes: Number(row.MinNoticeMinutes) || 30,
      defaultServiceDurationMinutes:
        Number(row.DefaultServiceDurationMinutes) || 30,
    };
  } catch (err) {
    console.error("[getPublicSettings] DB error, using fallbacks:", err);
    return {
      salonName: "Cut Salon",
      timezone: "Africa/Cairo",
      currency: "EGP",
      bookingEnabled: true,
      allowSpecificBarber: true,
      allowNearestBarber: true,
      defaultMode: "nearest",
      slotIntervalMinutes: 15,
      maxBookingDaysAhead: 14,
      minNoticeMinutes: 30,
      defaultServiceDurationMinutes: 30,
    };
  }
}

// ── Customer upsert ───────────────────────────────────────────────────────────

/**
 * Find an existing client by phone or create one.
 * Returns the ClientID.
 */
export async function upsertCustomer(
  name: string,
  phone: string,
): Promise<number> {
  const db = await getPool();

  const existing = await db
    .request()
    .input("mobile", sql.NVarChar, phone.trim())
    .query(
      `SELECT TOP 1 ClientID FROM [dbo].[TblClient] WHERE Mobile = @mobile`,
    );

  if (existing.recordset.length > 0) {
    return existing.recordset[0].ClientID as number;
  }

  const inserted = await db
    .request()
    .input("name", sql.NVarChar, name.trim())
    .input("mobile", sql.NVarChar, phone.trim()).query(`
      INSERT INTO [dbo].[TblClient] ([Name], Mobile, RegisterDate)
      OUTPUT INSERTED.ClientID
      VALUES (@name, @mobile, GETDATE())
    `);
  return inserted.recordset[0].ClientID as number;
}

// ── CORS headers for public endpoints ────────────────────────────────────────

export const PUBLIC_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-public-booking-key",
  "Cache-Control": "no-store",
};

// ── Timezone helpers ─────────────────────────────────────────────────────────

/**
 * Convert a salon-local wall-clock time (YYYY-MM-DD HH:MM) to UTC epoch milliseconds.
 * This compensates for server timezone differences (e.g., server=UTC vs salon=Africa/Cairo).
 */
export function salonDateTimeToMs(
  dateStr: string,
  hhmm: string,
  tz: string,
): number {
  try {
    const [h, m] = hhmm.split(":").map(Number);
    // Reference: noon UTC on that date — to find offset
    const noonUtc = new Date(`${dateStr}T12:00:00Z`);
    const noonLocal = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "shortOffset",
    }).formatToParts(noonUtc);
    // Extract offset from the formatted parts (e.g., "GMT+3" → +180)
    const offsetPart =
      noonLocal.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
    const offsetMatch = offsetPart.match(/GMT([+-]\d+(?::\d+)?)/);
    let offsetMinutes = 0;
    if (offsetMatch) {
      const parts = offsetMatch[1].split(":");
      offsetMinutes =
        parseInt(parts[0], 10) * 60 +
        (parts[1]
          ? parseInt(parts[1], 10) * Math.sign(parseInt(parts[0], 10))
          : 0);
    }
    // Construct epoch: midnight UTC on that date, minus TZ offset (to get midnight local),
    // then add desired HH:MM
    const midnightUtcMs = new Date(`${dateStr}T00:00:00Z`).getTime();
    return midnightUtcMs - offsetMinutes * 60_000 + (h * 60 + m) * 60_000;
  } catch {
    // Fallback: treat as local server time
    return new Date(`${dateStr}T${hhmm}:00`).getTime();
  }
}

/** Returns "YYYY-MM-DD" for today in the given IANA timezone. */
export function dateInTimezone(now: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const y = parts.find((p) => p.type === "year")?.value ?? "";
    const mo = parts.find((p) => p.type === "month")?.value ?? "";
    const d = parts.find((p) => p.type === "day")?.value ?? "";
    return `${y}-${mo}-${d}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Returns "HH:MM" for the given time in the specified timezone. */
export function timeInTimezone(dt: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(dt);
    const h = parts.find((p) => p.type === "hour")?.value ?? "00";
    const m = parts.find((p) => p.type === "minute")?.value ?? "00";
    return `${h}:${m}`;
  } catch {
    return `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
  }
}

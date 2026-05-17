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

import { getPool, sql } from '@/lib/db';
import { NextRequest } from 'next/server';

// ── Rate limiting ─────────────────────────────────────────────────────────────

const ipHits = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_MAX       = 60;     // requests per minute per IP

export function getRateLimitKey(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
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
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'BK-';
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
  salonName:                string;
  timezone:                 string;
  currency:                 string;
  bookingEnabled:           boolean;
  allowSpecificBarber:      boolean;
  allowNearestBarber:       boolean;
  defaultMode:              'nearest' | 'specific';
  slotIntervalMinutes:      number;
  maxBookingDaysAhead:      number;
  minNoticeMinutes:         number;
  defaultServiceDurationMinutes: number;
}

export async function getPublicSettings(): Promise<PublicSettings> {
  try {
    const db  = await getPool();
    const res = await db.request().query(`
      SELECT TOP 1
        ISNULL(SalonName, N'الصالون') AS SalonName,
        ISNULL(BookingEnabled, 1)            AS BookingEnabled,
        ISNULL(AllowSpecificBarber, 1)       AS AllowSpecificBarber,
        ISNULL(AllowNearestBarber, 1)        AS AllowNearestBarber,
        ISNULL(DefaultMode, N'nearest')      AS DefaultMode,
        ISNULL(SlotIntervalMinutes, 15)      AS SlotIntervalMinutes,
        ISNULL(MaxBookingDaysAhead, 14)      AS MaxBookingDaysAhead,
        ISNULL(MinNoticeMinutes, 30)         AS MinNoticeMinutes,
        ISNULL(DefaultServiceDurationMinutes, ISNULL(DefaultServiceMinutes, 30)) AS DefaultServiceDurationMinutes
      FROM [dbo].[QueueBookingSettings]
    `).catch(() => ({ recordset: [] as any[] }));

    const row = res.recordset[0] ?? {};
    return {
      salonName:                row.SalonName              ?? 'الصالون',
      timezone:                 'Africa/Cairo',
      currency:                 'EGP',
      bookingEnabled:           !!row.BookingEnabled,
      allowSpecificBarber:      row.AllowSpecificBarber !== 0,
      allowNearestBarber:       row.AllowNearestBarber  !== 0,
      defaultMode:              (row.DefaultMode === 'specific' ? 'specific' : 'nearest'),
      slotIntervalMinutes:      Number(row.SlotIntervalMinutes)      || 15,
      maxBookingDaysAhead:      Number(row.MaxBookingDaysAhead)      || 14,
      minNoticeMinutes:         Number(row.MinNoticeMinutes)         || 30,
      defaultServiceDurationMinutes: Number(row.DefaultServiceDurationMinutes) || 30,
    };
  } catch {
    return {
      salonName:                'الصالون',
      timezone:                 'Africa/Cairo',
      currency:                 'EGP',
      bookingEnabled:           true,
      allowSpecificBarber:      true,
      allowNearestBarber:       true,
      defaultMode:              'nearest',
      slotIntervalMinutes:      15,
      maxBookingDaysAhead:      14,
      minNoticeMinutes:         30,
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
  name:  string,
  phone: string,
): Promise<number> {
  const db = await getPool();

  const existing = await db.request()
    .input('mobile', sql.NVarChar, phone.trim())
    .query(`SELECT TOP 1 ClientID FROM [dbo].[TblClient] WHERE Mobile = @mobile`);

  if (existing.recordset.length > 0) {
    return existing.recordset[0].ClientID as number;
  }

  const inserted = await db.request()
    .input('name',   sql.NVarChar, name.trim())
    .input('mobile', sql.NVarChar, phone.trim())
    .query(`
      INSERT INTO [dbo].[TblClient] ([Name], Mobile, RegisterDate)
      OUTPUT INSERTED.ClientID
      VALUES (@name, @mobile, GETDATE())
    `);
  return inserted.recordset[0].ClientID as number;
}

// ── CORS headers for public endpoints ────────────────────────────────────────

export const PUBLIC_CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-public-booking-key',
  'Cache-Control':                'no-store',
};

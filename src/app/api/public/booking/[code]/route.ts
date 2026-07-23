import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import {
  getRateLimitKey,
  checkRateLimit,
  PUBLIC_CORS_HEADERS,
} from '@/lib/publicBookingHelpers';
import { getBranchById } from '@/lib/branch';
import { toPublicBranchSafe } from '@/lib/branch/bookingQueueOwnership';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ code: string }> };

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

// ── GET /api/public/booking/:code ─────────────────────────────────────────────

/**
 * Returns public booking details for the confirmation page.
 * Only exposes safe fields — no internal IDs beyond booking code.
 */
export async function GET(req: NextRequest, context: RouteContext) {
  const ip = getRateLimitKey(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'طلبات كثيرة' }, { status: 429, headers: PUBLIC_CORS_HEADERS });
  }

  const { code: rawCode } = await context.params;
  const code = rawCode?.trim().toUpperCase();
  if (!code) {
    return NextResponse.json({ error: 'كود الحجز مطلوب' }, { status: 400, headers: PUBLIC_CORS_HEADERS });
  }

  try {
    const db = await getPool();

    // Try lookup by BookingCode column; fall back to numeric BookingID.
    // No branchCode required here — booking codes are globally unique, so a
    // customer can look up their confirmation without knowing the branch.
    const res = await db.request()
      .input('code', sql.NVarChar, code)
      .query(`
        SELECT
          b.BookingID,
          b.BranchID,
          b.BookingDate,
          b.StartTime,
          b.EndTime,
          b.Status,
          b.Notes,
          c.[Name]   AS CustomerName,
          c.Mobile   AS CustomerPhone,
          e.EmpName  AS BarberName,
          (
            SELECT STRING_AGG(p.ProName, ', ')
            FROM [dbo].[BookingServices] bs
            JOIN [dbo].[TblPro] p ON p.ProID = bs.ProID
            WHERE bs.BookingID = b.BookingID
          ) AS ServicesText
        FROM [dbo].[Bookings] b
        LEFT JOIN [dbo].[TblClient] c ON c.ClientID = b.ClientID
        LEFT JOIN [dbo].[TblEmp]    e ON e.EmpID    = b.AssignedEmpID
        WHERE b.BookingCode = @code
      `).catch(() =>
        // Fallback: BookingCode column may not exist — search by numeric ID
        db.request()
          .input('id', sql.Int, isNaN(Number(code)) ? -1 : Number(code))
          .query(`
            SELECT
              b.BookingID,
              b.BranchID,
              b.BookingDate,
              b.StartTime,
              b.EndTime,
              b.Status,
              b.Notes,
              c.[Name]   AS CustomerName,
              c.Mobile   AS CustomerPhone,
              e.EmpName  AS BarberName,
              (
                SELECT STRING_AGG(p.ProName, ', ')
                FROM [dbo].[BookingServices] bs
                JOIN [dbo].[TblPro] p ON p.ProID = bs.ProID
                WHERE bs.BookingID = b.BookingID
              ) AS ServicesText
            FROM [dbo].[Bookings] b
            LEFT JOIN [dbo].[TblClient] c ON c.ClientID = b.ClientID
            LEFT JOIN [dbo].[TblEmp]    e ON e.EmpID    = b.AssignedEmpID
            WHERE b.BookingID = @id
          `)
      );

    const row = res.recordset[0];
    if (!row) {
      return NextResponse.json({ error: 'الحجز غير موجود' }, { status: 404, headers: PUBLIC_CORS_HEADERS });
    }

    const branch = row.BranchID != null ? await getBranchById(Number(row.BranchID)) : null;

    return NextResponse.json({
      ok: true,
      booking: {
        code,
        status:        row.Status,
        customerName:  row.CustomerName ?? null,
        barberName:    row.BarberName   ?? null,
        servicesText:  row.ServicesText ?? null,
        date:          typeof row.BookingDate === 'string'
          ? row.BookingDate.slice(0, 10)
          : new Date(row.BookingDate).toISOString().slice(0, 10),
        startTime: fmtTime(row.StartTime),
        endTime:   fmtTime(row.EndTime),
        notes:     row.Notes ?? null,
        branch: branch ? toPublicBranchSafe(branch) : null,
      },
    }, { headers: PUBLIC_CORS_HEADERS });
  } catch (err) {
    console.error('[public/booking/:code GET]', err);
    return NextResponse.json({ error: 'فشل تحميل الحجز' }, { status: 500, headers: PUBLIC_CORS_HEADERS });
  }
}

// ── POST /api/public/booking/:code/cancel lives in [code]/cancel/route.ts ─────
// This route only handles GET — see adjacent cancel route.

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 5);
  if (v instanceof Date)
    return `${String(v.getHours()).padStart(2, '0')}:${String(v.getMinutes()).padStart(2, '0')}`;
  return null;
}

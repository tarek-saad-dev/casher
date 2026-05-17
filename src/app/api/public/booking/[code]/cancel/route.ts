import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import {
  getRateLimitKey,
  checkRateLimit,
  isValidPhone,
  PUBLIC_CORS_HEADERS,
} from '@/lib/publicBookingHelpers';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ code: string }> };

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

/**
 * POST /api/public/booking/:code/cancel
 *
 * Body: { phone, reason? }
 *
 * Cancels the booking only if the provided phone matches the customer's phone.
 * Only cancellable statuses: pending, confirmed.
 */
export async function POST(req: NextRequest, context: RouteContext) {
  const ip = getRateLimitKey(req);
  if (!checkRateLimit(ip, 20)) {
    return NextResponse.json({ error: 'طلبات كثيرة' }, { status: 429, headers: PUBLIC_CORS_HEADERS });
  }

  const { code: rawCode } = await context.params;
  const code = rawCode?.trim().toUpperCase();
  if (!code) {
    return NextResponse.json({ error: 'كود الحجز مطلوب' }, { status: 400, headers: PUBLIC_CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const { phone, reason = '' } = body as { phone?: string; reason?: string };

    if (!phone || !isValidPhone(phone)) {
      return NextResponse.json({ error: 'رقم الهاتف مطلوب للتحقق' }, { status: 400, headers: PUBLIC_CORS_HEADERS });
    }

    const db = await getPool();

    // Lookup booking by code
    const res = await db.request()
      .input('code', sql.NVarChar, code)
      .query(`
        SELECT b.BookingID, b.Status, c.Mobile
        FROM [dbo].[Bookings] b
        LEFT JOIN [dbo].[TblClient] c ON c.ClientID = b.ClientID
        WHERE b.BookingCode = @code
      `).catch(() =>
        db.request()
          .input('id', sql.Int, isNaN(Number(code)) ? -1 : Number(code))
          .query(`
            SELECT b.BookingID, b.Status, c.Mobile
            FROM [dbo].[Bookings] b
            LEFT JOIN [dbo].[TblClient] c ON c.ClientID = b.ClientID
            WHERE b.BookingID = @id
          `)
      );

    const row = res.recordset[0];
    if (!row) {
      return NextResponse.json({ error: 'الحجز غير موجود' }, { status: 404, headers: PUBLIC_CORS_HEADERS });
    }

    // Verify phone matches
    const storedPhone = (row.Mobile ?? '').replace(/\s/g, '');
    const inputPhone  = phone.replace(/\s/g, '');
    if (storedPhone !== inputPhone) {
      return NextResponse.json({ error: 'رقم الهاتف غير مطابق' }, { status: 403, headers: PUBLIC_CORS_HEADERS });
    }

    // Only allow cancelling if status is pending or confirmed
    const cancellable = ['pending', 'confirmed'];
    if (!cancellable.includes(row.Status)) {
      return NextResponse.json({
        error: `لا يمكن إلغاء الحجز في الحالة الحالية: ${row.Status}`,
      }, { status: 409, headers: PUBLIC_CORS_HEADERS });
    }

    // Cancel
    await db.request()
      .input('id',     sql.Int,      row.BookingID)
      .input('reason', sql.NVarChar, reason.trim() || 'إلغاء العميل')
      .query(`
        UPDATE [dbo].[Bookings]
        SET Status       = 'cancelled',
            CancelledAt  = GETDATE(),
            CancelReason = @reason
        WHERE BookingID  = @id
      `);

    return NextResponse.json({
      ok:      true,
      message: 'تم إلغاء الحجز بنجاح',
    }, { headers: PUBLIC_CORS_HEADERS });
  } catch (err) {
    console.error('[public/booking/:code/cancel]', err);
    return NextResponse.json({ error: 'فشل إلغاء الحجز' }, { status: 500, headers: PUBLIC_CORS_HEADERS });
  }
}

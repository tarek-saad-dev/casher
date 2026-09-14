import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  GroomPackageBookingError,
  parseGroomPackageMetadataNote,
  resolveGroomPackageBooking,
} from '@/lib/booking/groomPackageBooking';

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * GET /api/pos/groom-packages/from-booking/[id]
 * Hydrate POS package UX from an existing booking that carries [groomPackage] notes.
 */
export async function GET(_req: NextRequest, { params }: RouteCtx) {
  const auth = await requirePageAccess('/income/pos');
  if (!isAuthResult(auth)) return auth;

  try {
    const { id } = await params;
    const bookingId = parseInt(id, 10);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return NextResponse.json({ error: 'Invalid booking id' }, { status: 400 });
    }

    const db = await getPool();
    const bookingRes = await db
      .request()
      .input('id', sql.Int, bookingId)
      .query(`
        SELECT BookingID, ClientID, AssignedEmpID, Notes, Status, BookingCode
        FROM dbo.Bookings
        WHERE BookingID = @id
      `);
    const booking = bookingRes.recordset[0] as
      | {
          BookingID: number;
          ClientID: number | null;
          AssignedEmpID: number | null;
          Notes: string | null;
          Status: string | null;
          BookingCode: string | null;
        }
      | undefined;

    if (!booking) {
      return NextResponse.json({ error: 'الحجز غير موجود' }, { status: 404 });
    }

    const parsed = parseGroomPackageMetadataNote(booking.Notes);
    if (!parsed) {
      return NextResponse.json({
        ok: true,
        hasPackage: false,
        bookingId: booking.BookingID,
        bookingCode: booking.BookingCode,
        clientId: booking.ClientID,
        assignedEmpId: booking.AssignedEmpID,
      });
    }

    const resolved = await resolveGroomPackageBooking({
      packageId: parsed.packageId,
      addonProIds: parsed.addonProIds,
    });

    const servicesRes = await db
      .request()
      .input('id', sql.Int, bookingId)
      .query(`
        SELECT bs.ProID, bs.EmpID, bs.Price, bs.DurationMinutes, p.ProName, p.ProNameAr
        FROM dbo.BookingServices bs
        LEFT JOIN dbo.TblPro p ON p.ProID = bs.ProID
        WHERE bs.BookingID = @id
        ORDER BY bs.BookingServiceID
      `);

    return NextResponse.json({
      ok: true,
      hasPackage: true,
      bookingId: booking.BookingID,
      bookingCode: booking.BookingCode,
      clientId: booking.ClientID,
      assignedEmpId: booking.AssignedEmpID,
      notes: booking.Notes,
      parsed,
      packageId: resolved.packageId,
      nameEn: resolved.nameEn,
      nameAr: resolved.nameAr,
      packagePrice: resolved.packagePrice,
      packageDurationMinutes: resolved.packageDurationMinutes,
      totalDurationMinutes: resolved.totalDurationMinutes,
      requiredServiceIds: resolved.requiredServiceIds,
      addonProIds: resolved.addonProIds,
      addonTotal: resolved.addonTotal,
      totalPrice: resolved.totalPrice,
      metadataNote: resolved.metadataNote,
      services: resolved.services.map((s) => ({
        serviceId: s.serviceId,
        nameEn: s.nameEn,
        nameAr: s.nameAr,
        price: s.price,
        durationMinutes: s.durationMinutes,
      })),
      bookingServices: servicesRes.recordset,
    });
  } catch (err: unknown) {
    if (err instanceof GroomPackageBookingError) {
      return NextResponse.json(
        { ok: false, error: err.code, code: err.code, metadata: err.metadata },
        { status: 400 },
      );
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/pos/groom-packages/from-booking] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

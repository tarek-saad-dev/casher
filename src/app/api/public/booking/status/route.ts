import { NextRequest, NextResponse } from 'next/server';
import {
  getPublicSettings,
  getRateLimitKey,
  checkRateLimit,
  PUBLIC_CORS_HEADERS,
  PUBLIC_BOOKING_DISABLED_CLIENT_MESSAGE,
} from '@/lib/publicBookingHelpers';
import {
  extractPublicBranchCode,
  resolvePublicBranchCode,
  publicBranchRequiredResponse,
  publicInvalidBranchResponse,
} from '@/lib/branch/bookingQueueOwnership';
import { BranchDomainError } from '@/lib/branch/types';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

/**
 * GET /api/public/booking/status?branchCode=XXX
 *
 * Lightweight public gate for the client website.
 * Driven by the same QueueBookingSettings.BookingEnabled flag as the
 * «حجز الموقع» toggle on /operations (PATCH /api/admin/booking-settings).
 *
 * - bookingEnabled=true  → show booking UI
 * - bookingEnabled=false → hide barbers section; show `message`
 */
export async function GET(req: NextRequest) {
  const ip = getRateLimitKey(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { ok: false, error: 'طلبات كثيرة — حاول لاحقاً' },
      { status: 429, headers: PUBLIC_CORS_HEADERS },
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const branchCode = extractPublicBranchCode(searchParams);
    let branch;
    try {
      branch = await resolvePublicBranchCode(branchCode, {
        route: '/api/public/booking/status',
      });
    } catch (err) {
      if (err instanceof BranchDomainError) {
        return err.code === 'BRANCH_REQUIRED'
          ? publicBranchRequiredResponse()
          : publicInvalidBranchResponse();
      }
      throw err;
    }

    const settings = await getPublicSettings(branch.branchId);
    const bookingEnabled = !!settings.bookingEnabled;

    return NextResponse.json(
      {
        ok: true,
        bookingEnabled,
        ...(bookingEnabled
          ? {}
          : { message: PUBLIC_BOOKING_DISABLED_CLIENT_MESSAGE }),
      },
      { headers: PUBLIC_CORS_HEADERS },
    );
  } catch (err) {
    console.error('[public/booking/status]', err);
    return NextResponse.json(
      { ok: false, error: 'فشل تحميل حالة الحجز' },
      { status: 500, headers: PUBLIC_CORS_HEADERS },
    );
  }
}

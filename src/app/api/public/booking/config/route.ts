import { NextRequest, NextResponse } from 'next/server';
import {
  getPublicSettings,
  getRateLimitKey,
  checkRateLimit,
  PUBLIC_CORS_HEADERS,
} from '@/lib/publicBookingHelpers';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

/**
 * GET /api/public/booking/config
 * Returns public widget configuration — no auth required.
 */
export async function GET(req: NextRequest) {
  const ip = getRateLimitKey(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'طلبات كثيرة — حاول لاحقاً' }, { status: 429, headers: PUBLIC_CORS_HEADERS });
  }

  try {
    const settings = await getPublicSettings();

    return NextResponse.json({
      ok: true,
      salon: {
        name:           settings.salonName,
        logoUrl:        null,
        timezone:       settings.timezone,
        currency:       settings.currency,
        bookingEnabled: settings.bookingEnabled,
      },
      settings: {
        allowSpecificBarber:  settings.allowSpecificBarber,
        allowNearestBarber:   settings.allowNearestBarber,
        defaultMode:          settings.defaultMode,
        slotIntervalMinutes:  settings.slotIntervalMinutes,
        maxBookingDaysAhead:  settings.maxBookingDaysAhead,
        minNoticeMinutes:     settings.minNoticeMinutes,
      },
    }, { headers: PUBLIC_CORS_HEADERS });
  } catch (err) {
    console.error('[public/booking/config]', err);
    return NextResponse.json({ error: 'فشل تحميل الإعدادات' }, { status: 500, headers: PUBLIC_CORS_HEADERS });
  }
}

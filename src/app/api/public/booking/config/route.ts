import { NextRequest, NextResponse } from 'next/server';
import {
  getPublicSettings,
  getRateLimitKey,
  checkRateLimit,
  PUBLIC_CORS_HEADERS,
} from '@/lib/publicBookingHelpers';
import {
  extractPublicBranchCode,
  resolvePublicBranchCode,
  publicBranchRequiredResponse,
  publicInvalidBranchResponse,
  toPublicBranchSafe,
} from '@/lib/branch/bookingQueueOwnership';
import { BranchDomainError } from '@/lib/branch/types';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

/**
 * GET /api/public/booking/config?branchCode=XXX
 * Returns public widget configuration — no auth required.
 * Branch is required — never silently defaults to a founding branch.
 */
export async function GET(req: NextRequest) {
  const ip = getRateLimitKey(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'طلبات كثيرة — حاول لاحقاً' }, { status: 429, headers: PUBLIC_CORS_HEADERS });
  }

  try {
    const { searchParams } = new URL(req.url);
    const branchCode = extractPublicBranchCode(searchParams);
    let branch;
    try {
      branch = await resolvePublicBranchCode(branchCode, {
        route: '/api/public/booking/config',
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

    return NextResponse.json({
      ok: true,
      branch: toPublicBranchSafe(branch),
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

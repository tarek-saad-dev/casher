import { NextRequest, NextResponse } from 'next/server';
import {
  getRateLimitKey,
  checkRateLimit,
  PUBLIC_CORS_HEADERS,
} from '@/lib/publicBookingHelpers';
import { listPublicActiveBranches } from '@/lib/branch/bookingQueueOwnership';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

/**
 * GET /api/public/branches
 * Returns active branches — no auth required. Used by the public booking
 * widget to let the customer pick a branch before loading branch-scoped data.
 */
export async function GET(req: NextRequest) {
  const ip = getRateLimitKey(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'طلبات كثيرة — حاول لاحقاً' },
      { status: 429, headers: PUBLIC_CORS_HEADERS },
    );
  }

  try {
    const branches = await listPublicActiveBranches();
    return NextResponse.json({ ok: true, branches }, { headers: PUBLIC_CORS_HEADERS });
  } catch (err) {
    console.error('[public/branches]', err);
    return NextResponse.json(
      { error: 'فشل تحميل الفروع' },
      { status: 500, headers: PUBLIC_CORS_HEADERS },
    );
  }
}

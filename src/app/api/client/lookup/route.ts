/**
 * GET /api/client/lookup?mobile=...
 * Public client website lookup — no staff session required.
 */

import { NextRequest, NextResponse } from 'next/server';
import { lookupClientByMobile } from '@/lib/client/publicClientWebsite.service';
import { isPublicClientWebsiteLookupRateLimited } from '@/lib/client/publicClientWebsiteRateLimit';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (isPublicClientWebsiteLookupRateLimited(req)) {
    return NextResponse.json(
      { ok: false, message: 'Too many requests' },
      { status: 429 },
    );
  }

  const mobile = req.nextUrl.searchParams.get('mobile');
  if (!mobile || !mobile.trim()) {
    return NextResponse.json(
      { ok: false, message: 'mobile parameter is required' },
      { status: 400 },
    );
  }

  try {
    const client = await lookupClientByMobile(mobile);

    if (!client) {
      return NextResponse.json({
        ok: true,
        found: false,
        client: null,
      });
    }

    return NextResponse.json({
      ok: true,
      found: true,
      client,
    });
  } catch (err: unknown) {
    console.error('[api/client/lookup] GET error:', err);
    return NextResponse.json(
      { ok: false, message: 'Database error' },
      { status: 500 },
    );
  }
}

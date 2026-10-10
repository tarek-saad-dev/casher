/**
 * GET /api/public/booking/v2/bootstrap
 * Cached catalog for Hawai /operations + cutsaloon.com (no live availability).
 */
import { NextRequest, NextResponse } from 'next/server';
import { withPublicBookingCors } from '@/lib/booking/publicBookingCors';
import {
  gatePublicBookingRoute,
  finalizePublicBookingError,
  finalizePublicBookingJson,
  publicBookingTenantOptionsResponse,
  requirePublicBookingRouteTenancy,
} from '@/lib/booking/publicBookingRouteGate';
import { applyPublicBookingResponseHeaders } from '@/lib/booking/publicBookingResponse';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  return publicBookingTenantOptionsResponse(req, 'v2-bootstrap');
}

export async function GET(req: NextRequest) {
  const { gate, blocked } = gatePublicBookingRoute(req, 'v2-bootstrap');
  if (blocked) return blocked;

  try {
    const { searchParams } = new URL(req.url);
    const preview = searchParams.get('preview');
    const ifNoneMatch = req.headers.get('if-none-match');

    const tenancy = await requirePublicBookingRouteTenancy(req, gate, {
      branchCode: searchParams.get('branchCode'),
      allowCutCompat: true,
    });
    if (tenancy instanceof NextResponse) return tenancy;

    const {
      buildPublicBookingV2Bootstrap,
      PUBLIC_BOOTSTRAP_CACHE_CONTROL,
    } = await import('@/lib/booking/v2Frontend/buildPublicBootstrap');
    const { body, etag, cacheHit, timings } = await buildPublicBookingV2Bootstrap({
      tenantId: tenancy.tenantId,
      previewQueryParam: preview,
    });

    if (ifNoneMatch && ifNoneMatch === etag) {
      let notModified = new NextResponse(null, { status: 304 });
      notModified.headers.set('ETag', etag);
      notModified.headers.set('X-Bootstrap-Cache', cacheHit ? 'HIT' : 'MISS');
      if (timings?.source) {
        notModified.headers.set('X-Bootstrap-Source', timings.source);
      }
      // 304 must still carry CORS — browsers reject cross-origin 304 without ACAO.
      notModified = withPublicBookingCors(notModified, req, {
        allowedMethods: [...gate.cors.methods],
        allowedHeaders: gate.cors.headers,
        cacheControl: PUBLIC_BOOTSTRAP_CACHE_CONTROL,
        allowedOrigins: gate.tenantOrigins ?? null,
      });
      applyPublicBookingResponseHeaders(notModified, {
        requestId: gate.requestId,
        rateLimit: {
          limit: gate.rateLimit.limit,
          remaining: gate.rateLimit.remaining,
          resetAt: gate.rateLimit.resetAt,
        },
      });
      return notModified;
    }

    const res = finalizePublicBookingJson(req, gate, body, {
      cacheControl: PUBLIC_BOOTSTRAP_CACHE_CONTROL,
    });
    res.headers.set('ETag', etag);
    res.headers.set('X-Bootstrap-Revision', body.revision);
    res.headers.set('X-Bootstrap-Cache', cacheHit ? 'HIT' : 'MISS');
    if (timings?.source) {
      res.headers.set('X-Bootstrap-Source', timings.source);
    }
    if (timings?.totalMs != null) {
      res.headers.set('Server-Timing', `bootstrap;dur=${timings.totalMs.toFixed(0)}`);
    }
    return res;
  } catch (err) {
    console.error(
      '[public/booking/v2/bootstrap]',
      err instanceof Error ? err.message : 'error',
    );
    return finalizePublicBookingError(req, gate, 'AVAILABILITY_UNAVAILABLE');
  }
}

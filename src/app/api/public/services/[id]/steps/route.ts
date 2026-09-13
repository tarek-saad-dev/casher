import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import {
  activeProExists,
  listStepsByProId,
  toPublicExecutionStepWire,
} from '@/lib/catalog/serviceExecutionSteps';
import { ensureProExecutionStepsTable } from '@/lib/migrations/ensureProExecutionSteps';
import {
  PUBLIC_CORS_HEADERS,
  checkRateLimit,
  getRateLimitKey,
} from '@/lib/publicBookingHelpers';

export const runtime = 'nodejs';

/** Anonymous + CORS — client website service stages. */
const CORS_HEADERS = {
  ...PUBLIC_CORS_HEADERS,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

type RouteCtx = { params: Promise<{ id: string }> };

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/public/services/[id]/steps
 *
 * Public read of execution stages for an active service.
 * Response: { ok, serviceId, stepsCount, steps: [...] }
 */
export async function GET(_req: NextRequest, { params }: RouteCtx) {
  const ip = getRateLimitKey(_req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { ok: false, error: 'طلبات كثيرة' },
      { status: 429, headers: CORS_HEADERS },
    );
  }

  try {
    const { id } = await params;
    const proId = parseInt(id, 10);
    if (!Number.isFinite(proId) || proId <= 0) {
      return NextResponse.json(
        { ok: false, error: 'معرف الخدمة غير صالح' },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const db = await getPool();
    const ready = await ensureProExecutionStepsTable(db);
    if (!ready) {
      return NextResponse.json(
        { ok: false, error: 'خطوات التنفيذ غير متاحة حالياً' },
        { status: 503, headers: CORS_HEADERS },
      );
    }

    if (!(await activeProExists(db, proId))) {
      return NextResponse.json(
        { ok: false, error: 'الخدمة غير موجودة' },
        { status: 404, headers: CORS_HEADERS },
      );
    }

    const rows = await listStepsByProId(db, proId);
    const steps = toPublicExecutionStepWire(rows);

    return NextResponse.json(
      {
        ok: true,
        serviceId: proId,
        stepsCount: steps.length,
        hasSteps: steps.length > 0,
        steps,
      },
      { headers: CORS_HEADERS },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/public/services/[id]/steps] GET error:', message);
    return NextResponse.json(
      { ok: false, error: 'فشل تحميل خطوات التنفيذ' },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

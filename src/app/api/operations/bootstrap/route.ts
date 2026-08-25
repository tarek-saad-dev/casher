import { NextResponse } from 'next/server';
import {
  loadOperationalBootstrap,
} from '@/modules/operations/application/loadOperationalBootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/operations/bootstrap
 * Compact operational shell state.
 * Session cookie is ViewBranch only. OperationalBranch comes from the OPEN ShiftSession.
 */
export async function GET() {
  try {
    const result = await loadOperationalBootstrap();
    if (!result.ok) {
      return NextResponse.json(
        { error: result.message, code: result.code },
        { status: result.status },
      );
    }
    return NextResponse.json(result.data, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/operations/bootstrap] error:', message);
    return NextResponse.json(
      {
        error: 'تعذر تحميل حالة التشغيل. حاول مرة أخرى.',
        code: 'TEMPORARY_OPERATIONAL_READ_FAILURE',
      },
      { status: 503 },
    );
  }
}

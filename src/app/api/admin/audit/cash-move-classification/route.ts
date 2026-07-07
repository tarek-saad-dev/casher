import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireRole } from '@/lib/api-auth';
import { runCashMoveClassificationAudit } from '@/lib/accounting/cashMoveClassificationAudit';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/admin/audit/cash-move-classification
 * Read-only audit — classifies existing TblCashMove rows without mutating data.
 *
 * Query params:
 *   dateFrom  YYYY-MM-DD (optional)
 *   dateTo    YYYY-MM-DD (optional)
 *   limit     1..5000 (default 500)
 *   offset    >= 0 (default 0)
 *   includeNeedsReviewRows  true to return all needsReview rows (capped)
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(['super_admin', 'admin']);
  if (!isAuthResult(auth)) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('dateFrom') ?? undefined;
    const dateTo = searchParams.get('dateTo') ?? undefined;

    if (dateFrom && !DATE_RE.test(dateFrom)) {
      return NextResponse.json({ error: 'dateFrom يجب أن يكون بصيغة YYYY-MM-DD' }, { status: 400 });
    }
    if (dateTo && !DATE_RE.test(dateTo)) {
      return NextResponse.json({ error: 'dateTo يجب أن يكون بصيغة YYYY-MM-DD' }, { status: 400 });
    }

    const limit = searchParams.has('limit')
      ? parseInt(searchParams.get('limit') ?? '', 10)
      : undefined;
    const offset = searchParams.has('offset')
      ? parseInt(searchParams.get('offset') ?? '', 10)
      : undefined;
    const includeNeedsReviewRows = searchParams.get('includeNeedsReviewRows') === 'true';

    if (limit != null && (Number.isNaN(limit) || limit < 1)) {
      return NextResponse.json({ error: 'limit غير صالح' }, { status: 400 });
    }
    if (offset != null && (Number.isNaN(offset) || offset < 0)) {
      return NextResponse.json({ error: 'offset غير صالح' }, { status: 400 });
    }

    const result = await runCashMoveClassificationAudit({
      dateFrom,
      dateTo,
      limit,
      offset,
      includeNeedsReviewRows,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[audit/cash-move-classification]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

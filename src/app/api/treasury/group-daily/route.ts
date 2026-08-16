import { NextRequest, NextResponse } from 'next/server';
import { authenticate, isAuthResult } from '@/lib/api-auth';
import { getCairoCalendarDate } from '@/lib/businessDate';
import { loadGroupDailyTreasury } from '@/lib/services/treasuryGroupDailyService';

/**
 * GET /api/treasury/group-daily
 * Super-admin only — consolidated treasury for all branches on one calendar day.
 *
 * Query:
 *   day=YYYY-MM-DD (optional; defaults to Cairo today)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticate();
    if (!isAuthResult(auth)) return auth;
    if (!auth.isSuperAdmin) {
      return NextResponse.json(
        { error: 'غير مصرح — الصفحة لمدير النظام الكامل فقط' },
        { status: 403 },
      );
    }

    const dayParam = request.nextUrl.searchParams.get('day');
    const day =
      dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam)
        ? dayParam
        : getCairoCalendarDate();

    const data = await loadGroupDailyTreasury(day);
    return NextResponse.json(data);
  } catch (error) {
    console.error('[api/treasury/group-daily] GET error:', error);
    return NextResponse.json(
      {
        error: 'فشل تحميل ملخص خزنة كل الفروع',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

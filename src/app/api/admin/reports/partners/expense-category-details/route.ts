import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { canAccessPath } from '@/lib/permissions-server';
import { parseMonthYearParams, validateMonthYear } from '@/lib/reportMonthUtils';
import { validatePartnersReportMinimumPeriod } from '@/lib/reports/partnersReportPeriod';
import { getPartnersExpenseCategoryTransactions } from '@/lib/services/partnersExpenseCategoryDetailsService';

const PARTNERS_REPORT_PATH = '/admin/reports/partners';

function parseCategoryId(value: string | null): number | null {
  if (value == null || value === '' || value === 'null') return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * GET /api/admin/reports/partners/expense-category-details
 *   ?year=2026&month=6&categoryId=123&categoryName=بضاعة
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح — يرجى تسجيل الدخول' }, { status: 401 });
    }

    const allowed = await canAccessPath(
      session.UserID,
      session.UserName,
      session.UserLevel,
      PARTNERS_REPORT_PATH
    );
    if (!allowed) {
      return NextResponse.json({ error: 'غير مصرح — لا تملك صلاحية عرض هذا التقرير' }, { status: 403 });
    }

    const url = new URL(req.url);
    const { year, month } = parseMonthYearParams(
      url.searchParams.get('year'),
      url.searchParams.get('month')
    );
    const validationError = validateMonthYear(year, month);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const minimumPeriodError = validatePartnersReportMinimumPeriod(year, month);
    if (minimumPeriodError) {
      return NextResponse.json({ error: minimumPeriodError }, { status: 400 });
    }

    const categoryName = url.searchParams.get('categoryName')?.trim();
    if (!categoryName) {
      return NextResponse.json({ error: 'اسم الفئة مطلوب' }, { status: 400 });
    }

    const categoryId = parseCategoryId(url.searchParams.get('categoryId'));

    const transactions = await getPartnersExpenseCategoryTransactions(
      year,
      month,
      categoryId,
      categoryName
    );

    return NextResponse.json({
      year,
      month,
      categoryId,
      categoryName,
      transactions,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message.includes('مستبعدة') ? 400 : 500;
    console.error('[api/admin/reports/partners/expense-category-details] GET error:', message);
    return NextResponse.json({ error: message }, { status });
  }
}

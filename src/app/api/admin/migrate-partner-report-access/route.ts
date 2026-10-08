/**
 * POST /api/admin/migrate-partner-report-access
 * Idempotent: sets CanViewReports=1 for all partner-role users on their active branch links.
 */
import { NextResponse } from 'next/server';
import { requirePlatformOperator } from '@/lib/api-auth';
import { ensurePartnerUsersCanViewReports } from '@/lib/branch';

export const runtime = 'nodejs';

/** Platform operator only: the update spans partner users of every tenant. */
export async function POST() {
  try {
    const operator = await requirePlatformOperator();
    if (operator instanceof NextResponse) return operator;

    const result = await ensurePartnerUsersCanViewReports();
    return NextResponse.json({
      ok: true,
      updatedAccessRows: result.updatedAccessRows,
      message: 'تم تفعيل صلاحية تقارير الفرع لحسابات الشركاء',
    });
  } catch (err) {
    console.error('[migrate-partner-report-access]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Migration failed' },
      { status: 500 },
    );
  }
}

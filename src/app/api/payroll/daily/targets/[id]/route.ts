import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { getDailyTargetLedgerDetails } from '@/lib/payroll/employee-target';

/**
 * GET /api/payroll/daily/targets/[id]
 * Snapshot details for a TblEmpDailyTarget row + linked ledger entry match status.
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const { id: raw } = await context.params;
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'معرّف التارجت غير صالح' }, { status: 400 });
    }

    const details = await getDailyTargetLedgerDetails(id);
    if (!details) {
      return NextResponse.json({ error: 'سجل التارجت غير موجود' }, { status: 404 });
    }

    return NextResponse.json({ success: true, ...details });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/payroll/daily/targets/[id]] GET error:', message);
    return NextResponse.json({ error: 'تعذّر تحميل تفاصيل التارجت' }, { status: 500 });
  }
}

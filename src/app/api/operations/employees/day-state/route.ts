import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { listUserValidBranchAccess } from '@/lib/branch/repository';
import { loadOperationsDayState } from '@/lib/hr/operationsDayState';
import { getCairoBusinessDate } from '@/lib/businessDate';

export const runtime = 'nodejs';

/**
 * GET /api/operations/employees/day-state?date=YYYY-MM-DD
 * Scoped to session branch; optional includeElsewhere=1 for multi-branch managers.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePageAccess('/operations');
  if (!isAuthResult(auth)) return auth;

  try {
    const date =
      new URL(req.url).searchParams.get('date') || getCairoBusinessDate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ ok: false, error: 'date غير صالح' }, { status: 400 });
    }

    const includeElsewhere =
      new URL(req.url).searchParams.get('includeElsewhere') === '1';

    // Multi-branch summary only when user has >1 branch access
    let allowElsewhere = includeElsewhere;
    if (includeElsewhere) {
      const access = await listUserValidBranchAccess(auth.userId);
      allowElsewhere = access.filter((a) => a.canOperate || a.canSwitch).length > 1;
    }

    const state = await loadOperationsDayState({
      sessionBranchId: auth.activeBranchId,
      workDate: date,
      includeElsewhere: allowElsewhere,
    });

    return NextResponse.json({ ok: true, ...state });
  } catch (err) {
    console.error('[operations/day-state]', err);
    return NextResponse.json({ ok: false, error: 'فشل تحميل حالة اليوم' }, { status: 500 });
  }
}

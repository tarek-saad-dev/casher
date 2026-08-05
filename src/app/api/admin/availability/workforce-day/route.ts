/**
 * GET /api/admin/availability/workforce-day?date=YYYY-MM-DD
 * Branch-scoped workforce availability board (Phase 3B).
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  isActiveBranchContext,
  requireBranchOperationAccess,
} from '@/lib/branch/context';
import { isValidBusinessDate } from '@/lib/availability/dailyAdjustments';
import { getOperationalDate } from '@/lib/businessDate';
import { loadWorkforceDay } from '@/lib/availability/workforceDay';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  let auth = await requirePageAccess('/admin/workforce/availability');
  if (!isAuthResult(auth)) {
    auth = await requirePageAccess('/admin');
    if (!isAuthResult(auth)) return auth;
  }

  const branch = await requireBranchOperationAccess();
  if (!isActiveBranchContext(branch)) return branch;

  const started = Date.now();
  try {
    const { searchParams } = new URL(req.url);
    const dateRaw = searchParams.get('date');
    const businessDate =
      dateRaw && isValidBusinessDate(dateRaw) ? dateRaw : getOperationalDate();

    if (dateRaw && !isValidBusinessDate(dateRaw)) {
      return NextResponse.json(
        { ok: false, code: 'INVALID_DATE', error: 'تاريخ العمل غير صالح' },
        { status: 400 },
      );
    }

    const payload = await loadWorkforceDay({
      branchId: branch.branchId,
      branchCode: branch.branchCode,
      branchName: branch.branchName,
      businessDate,
    });

    if (process.env.NODE_ENV === 'development') {
      console.info(
        `[workforce-day] branch=${branch.branchId} date=${businessDate} emps=${payload.employees.length} ms=${Date.now() - started}`,
      );
    }

    return NextResponse.json(payload);
  } catch (err) {
    console.error('[admin/availability/workforce-day GET]', err);
    return NextResponse.json(
      { ok: false, error: 'فشل تحميل لوحة توافر الموظفين' },
      { status: 500 },
    );
  }
}

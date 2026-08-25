/**
 * POST /api/operations/schedule-control/restore-present
 *
 * HTTP shell for AttendanceCommandService.restorePresent (Phase B5).
 * One-shot ops action for weekly-off / day_off / Absent.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { cairoDateStr } from '@/lib/availabilityEngine';
import { getCairoBusinessDate } from '@/lib/businessDate';
import {
  AttendanceCommandError,
  RESTORE_PRESENT_FAILURE_MESSAGE,
  restorePresent,
} from '@/modules/attendance';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = await requirePageAccess('/operations');
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await req.json();
    const empId = Number(body.empId);
    const date = String(body.date || getCairoBusinessDate());
    if (!Number.isFinite(empId) || empId <= 0) {
      return NextResponse.json({ ok: false, error: 'empId غير صالح' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ ok: false, error: 'date غير صالح' }, { status: 400 });
    }

    const result = await restorePresent({
      empId,
      date,
      branchId: auth.activeBranchId,
      reason:
        typeof body.reason === 'string' && body.reason.trim()
          ? body.reason.trim()
          : null,
      todayBusiness: getCairoBusinessDate(),
      todayCalendar: cairoDateStr(new Date()),
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AttendanceCommandError) {
      return NextResponse.json(
        { ok: false, error: err.message },
        { status: err.statusCode },
      );
    }
    console.error('[schedule-control/restore-present]', err);
    return NextResponse.json(
      { ok: false, error: RESTORE_PRESENT_FAILURE_MESSAGE },
      { status: 500 },
    );
  }
}

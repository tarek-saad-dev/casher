import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, isAuthResult } from '@/lib/api-auth';
import {
  previewEmployeeGlobalWeeklySchedule,
  saveEmployeeGlobalWeeklySchedule,
} from '@/lib/hr/employeeGlobalWeeklyScheduleSave';
import { SchedulePolicyError } from '@/lib/hr/employeeBranchScheduleSave';

export const runtime = 'nodejs';

/**
 * POST /api/admin/employees/[id]/branch-schedule/preview
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  try {
    const { id } = await ctx.params;
    const empId = Number(id);
    const body = await req.json();
    if (!Number.isFinite(empId)) {
      return NextResponse.json({ ok: false, error: 'empId غير صالح' }, { status: 400 });
    }
    const preview = await previewEmployeeGlobalWeeklySchedule({
      empId,
      effectiveFrom: String(body.effectiveFrom || ''),
      days: Array.isArray(body.days) ? body.days : [],
    });
    return NextResponse.json({ ok: true, preview });
  } catch (err) {
    if (err instanceof SchedulePolicyError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message, details: err.details },
        { status: err.status },
      );
    }
    console.error('[branch-schedule/preview]', err);
    return NextResponse.json({ ok: false, error: 'فشل المعاينة' }, { status: 500 });
  }
}

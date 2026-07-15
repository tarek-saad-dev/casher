import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  EmployeeTargetValidationError,
  enqueueAndMaybeProcessTargetRecalc,
  getTargetRecalcRequestsForApi,
  parseEnqueueRecalcBody,
} from '@/lib/payroll/employee-target';
import { assertValidWorkDate } from '@/lib/payroll/employee-target/target.validation';
import type { TargetRecalcRequestStatus } from '@/lib/payroll/employee-target/employee-target-recalc.schemas';

function isMissingTable(message: string): boolean {
  return /tblemptargetrecalcrequest/i.test(message) && /invalid object|does not exist/i.test(message);
}

/** GET /api/payroll/daily/targets/recalc-requests?workDate=&status=&empId= */
export async function GET(req: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    const { searchParams } = new URL(req.url);
    const workDate = searchParams.get('workDate') || undefined;
    if (workDate) assertValidWorkDate(workDate);
    const empIdParam = searchParams.get('empId');
    const empId = empIdParam ? Number(empIdParam) : null;
    if (empIdParam && (!Number.isInteger(empId) || empId! <= 0)) {
      return NextResponse.json({ error: 'empId غير صالح' }, { status: 400 });
    }
    const status = searchParams.get('status') as TargetRecalcRequestStatus | null;
    if (
      status &&
      !['pending', 'processing', 'completed', 'failed'].includes(status)
    ) {
      return NextResponse.json({ error: 'status غير صالح' }, { status: 400 });
    }
    if (!workDate && !empId && !status) {
      return NextResponse.json(
        { error: 'حدد workDate أو empId أو status — النطاق غير المحدود مرفوض' },
        { status: 400 },
      );
    }

    const rows = await getTargetRecalcRequestsForApi({
      workDate,
      empId,
      status,
      limit: 100,
    });
    return NextResponse.json({ success: true, requests: rows });
  } catch (err: unknown) {
    if (err instanceof EmployeeTargetValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : '';
    if (isMissingTable(message)) {
      return NextResponse.json(
        { error: 'جدول طلبات إعادة حساب التارجت غير موجود — نفّذ الهجرة' },
        { status: 503 },
      );
    }
    console.error('[recalc-requests GET]', message);
    return NextResponse.json({ error: 'تعذّر تحميل طلبات إعادة الحساب' }, { status: 500 });
  }
}

/** POST enqueue (+ optional processNow) */
export async function POST(req: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
    }

    const parsed = parseEnqueueRecalcBody(body);
    const result = await enqueueAndMaybeProcessTargetRecalc({
      workDate: parsed.workDate,
      empIds: parsed.empIds,
      processNow: parsed.processNow,
      reason: parsed.reason || 'manual_recalc',
      actorUserId: auth.userId ?? null,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    if (err instanceof EmployeeTargetValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : '';
    if (isMissingTable(message)) {
      return NextResponse.json(
        { error: 'جدول طلبات إعادة حساب التارجت غير موجود — نفّذ الهجرة' },
        { status: 503 },
      );
    }
    console.error('[recalc-requests POST]', message);
    return NextResponse.json({ error: 'تعذّرت إعادة حساب التارجت' }, { status: 500 });
  }
}

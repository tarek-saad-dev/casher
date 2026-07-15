import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  EmployeeTargetValidationError,
  parseProcessRecalcBody,
  processEmployeeTargetRecalcRequests,
} from '@/lib/payroll/employee-target';

function isMissingTable(message: string): boolean {
  return /tblemptargetrecalcrequest/i.test(message) && /invalid object|does not exist/i.test(message);
}

/** POST /api/payroll/daily/targets/recalc-requests/process */
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

    const parsed = parseProcessRecalcBody(body);
    const result = await processEmployeeTargetRecalcRequests({
      workDate: parsed.workDate,
      empIds: parsed.empIds,
      requestIds: parsed.requestIds,
      maxRequests: parsed.maxRequests,
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
    console.error('[recalc-requests/process POST]', message);
    return NextResponse.json({ error: 'تعذّرت معالجة طلبات إعادة الحساب' }, { status: 500 });
  }
}

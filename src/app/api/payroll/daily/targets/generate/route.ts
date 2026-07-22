import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  EmployeeDailyTargetDomainError,
  EmployeeDailyTargetLedgerConflictError,
  EmployeeTargetValidationError,
  generateEmployeeDailyTargets,
  parseDailyTargetGenerateBody,
} from '@/lib/payroll/employee-target';

// POST /api/payroll/daily/targets/generate
// Body: { workDate, empIds? }
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePageAccess('/admin/hr');
    if (!isAuthResult(auth)) return auth;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
    }

    let parsed;
    try {
      parsed = parseDailyTargetGenerateBody(body);
    } catch (e: unknown) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'بيانات غير صالحة' },
        { status: 400 },
      );
    }

    const result = await generateEmployeeDailyTargets({
      workDate: parsed.workDate,
      generatedByUserId: auth.userId,
      empIds: parsed.empIds,
    });

    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof EmployeeTargetValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof EmployeeDailyTargetDomainError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof EmployeeDailyTargetLedgerConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error(
      '[api/payroll/daily/targets/generate] POST error:',
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: 'تعذّر توليد التارجت اليومي' }, { status: 500 });
  }
}

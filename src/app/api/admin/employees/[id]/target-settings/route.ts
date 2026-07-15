import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  EmployeeTargetConflictError,
  EmployeeTargetValidationError,
  getEmployeeTargetSettings,
  parseTargetSaveBody,
  saveEmployeeTargetPlan,
} from '@/lib/payroll/employee-target';

function statusFromError(err: unknown): number {
  if (err && typeof err === 'object' && 'status' in err && typeof (err as { status: unknown }).status === 'number') {
    return (err as { status: number }).status;
  }
  return 500;
}

// GET /api/admin/employees/:id/target-settings?effectiveDate=YYYY-MM-DD
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const { id } = await params;
    const empId = parseInt(id, 10);
    if (Number.isNaN(empId)) {
      return NextResponse.json({ error: 'معرف الموظف غير صالح' }, { status: 400 });
    }

    const effectiveDate = req.nextUrl.searchParams.get('effectiveDate');
    const data = await getEmployeeTargetSettings(empId, effectiveDate);

    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'خطأ غير متوقع';
    const status = statusFromError(err);
    if (status === 404) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    console.error('[target-settings] GET error:', message);
    return NextResponse.json({ error: 'تعذّر تحميل إعدادات التارجت' }, { status: 500 });
  }
}

// PUT /api/admin/employees/:id/target-settings
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const { id } = await params;
    const empId = parseInt(id, 10);
    if (Number.isNaN(empId)) {
      return NextResponse.json({ error: 'معرف الموظف غير صالح' }, { status: 400 });
    }

    const body = await req.json();
    let parsed;
    try {
      parsed = parseTargetSaveBody(body);
    } catch (e: unknown) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'بيانات غير صالحة' },
        { status: 400 },
      );
    }

    const saved = await saveEmployeeTargetPlan(empId, parsed, session.UserID ?? null);
    return NextResponse.json({ plan: saved });
  } catch (err: unknown) {
    if (err instanceof EmployeeTargetValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof EmployeeTargetConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const status = statusFromError(err);
    if (status === 404) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'الموظف غير موجود' },
        { status: 404 },
      );
    }
    console.error(
      '[target-settings] PUT error:',
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: 'تعذّر حفظ إعدادات التارجت' }, { status: 500 });
  }
}

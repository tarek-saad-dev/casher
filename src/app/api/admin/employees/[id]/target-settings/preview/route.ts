import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  EmployeeTargetValidationError,
  parseTargetPreviewBody,
  previewEmployeeTargetPlan,
} from '@/lib/payroll/employee-target';

// POST /api/admin/employees/:id/target-settings/preview
export async function POST(
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
      parsed = parseTargetPreviewBody(body);
    } catch (e: unknown) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'بيانات غير صالحة' },
        { status: 400 },
      );
    }

    // EmpID is in the path for auth scoping / URL consistency; preview is pure calculation.
    void empId;
    const result = previewEmployeeTargetPlan(parsed);
    return NextResponse.json(result);
  } catch (err: unknown) {
    if (err instanceof EmployeeTargetValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error(
      '[target-settings/preview] POST error:',
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: 'تعذّر معاينة التارجت' }, { status: 500 });
  }
}

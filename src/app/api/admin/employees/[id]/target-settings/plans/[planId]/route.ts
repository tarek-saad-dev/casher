import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  EmployeeTargetConflictError,
  deleteEmployeeTargetPlan,
} from '@/lib/payroll/employee-target';

// DELETE /api/admin/employees/:id/target-settings/plans/:planId
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; planId: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const { id, planId: planIdRaw } = await params;
    const empId = parseInt(id, 10);
    const planId = parseInt(planIdRaw, 10);
    if (Number.isNaN(empId) || Number.isNaN(planId)) {
      return NextResponse.json({ error: 'معرف غير صالح' }, { status: 400 });
    }

    const result = await deleteEmployeeTargetPlan(empId, planId, session.UserID ?? null);
    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    if (err instanceof EmployeeTargetConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 404) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'غير موجود' },
        { status: 404 },
      );
    }
    console.error(
      '[target-settings/plans] DELETE error:',
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: 'تعذّر مسح الخطة' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireBranchOperationAccess } from '@/lib/branch/context';
import { deleteEmployeeTargetTemplate } from '@/lib/payroll/employee-target/employee-target-templates.store';

// DELETE /api/admin/hr/target-templates/:id
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const branch = await requireBranchOperationAccess();
    if (branch instanceof NextResponse) return branch;

    const { id } = await params;
    if (!id?.trim()) {
      return NextResponse.json({ error: 'معرف القالب غير صالح' }, { status: 400 });
    }

    const deleted = await deleteEmployeeTargetTemplate(id.trim());
    if (!deleted) {
      return NextResponse.json({ error: 'القالب غير موجود' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error(
      '[target-templates] DELETE error:',
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: 'تعذّر حذف القالب' }, { status: 500 });
  }
}

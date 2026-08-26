import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireBranchOperationAccess } from '@/lib/branch/context';
import {
  createEmployeeTargetTemplate,
  listEmployeeTargetTemplates,
} from '@/lib/payroll/employee-target/employee-target-templates.store';

// GET /api/admin/hr/target-templates
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const branch = await requireBranchOperationAccess();
    if (branch instanceof NextResponse) return branch;

    const templates = await listEmployeeTargetTemplates();
    return NextResponse.json({ templates });
  } catch (err: unknown) {
    console.error(
      '[target-templates] GET error:',
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: 'تعذّر تحميل قوالب التارجت' }, { status: 500 });
  }
}

// POST /api/admin/hr/target-templates
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const branch = await requireBranchOperationAccess();
    if (branch instanceof NextResponse) return branch;

    const body = await req.json();
    const template = await createEmployeeTargetTemplate({
      name: typeof body?.name === 'string' ? body.name : '',
      isEnabled: Boolean(body?.isEnabled),
      conversionDays: body?.conversionDays != null ? Number(body.conversionDays) : 26,
      tiers: Array.isArray(body?.tiers) ? body.tiers : [],
    });

    return NextResponse.json({ template }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'بيانات غير صالحة';
    if (
      message.includes('مطلوب') ||
      message.includes('غير صالحة') ||
      message.includes('المسموح') ||
      message.includes('تصاعدي') ||
      message.includes('تكرار') ||
      message.includes('شريحة')
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error('[target-templates] POST error:', message);
    return NextResponse.json({ error: 'تعذّر حفظ القالب' }, { status: 500 });
  }
}

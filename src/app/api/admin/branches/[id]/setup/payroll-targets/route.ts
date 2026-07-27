import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { listLaunchCoverageDashboard } from '@/lib/branch/launchRosterService';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePageAccess('/admin/branches');
  if (!isAuthResult(auth)) return auth;
  const branchId = Number((await params).id);
  if (!Number.isFinite(branchId)) {
    return NextResponse.json({ error: 'معرف فرع غير صالح' }, { status: 400 });
  }
  try {
    const data = await listLaunchCoverageDashboard(branchId);
    return NextResponse.json({ ok: true, branchId, ...data });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'فشل التحميل';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

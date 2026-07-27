import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { BranchDomainError } from '@/lib/branch/types';
import { activateBranchPartnerShares } from '@/lib/branch/activatePartnerShares';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePageAccess('/admin/branches');
  if (!isAuthResult(auth)) return auth;
  const branchId = Number((await params).id);
  if (!Number.isFinite(branchId)) {
    return NextResponse.json({ error: 'معرف فرع غير صالح' }, { status: 400 });
  }
  try {
    const body = await req.json();
    const effectiveFrom = String(body.effectiveFrom || '');
    const result = await activateBranchPartnerShares({
      branchId,
      effectiveFrom,
      actorUserId: auth.userId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof BranchDomainError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[partner-shares/activate]', err);
    return NextResponse.json({ error: 'فشل تفعيل نسب الشركاء' }, { status: 500 });
  }
}

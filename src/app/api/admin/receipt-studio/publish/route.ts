import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import { branchScope, parseScope, publishStudio, StudioError } from '@/lib/receipt-studio/storage';

export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;
  try {
    const body = await req.json();
    if (body.physicalProofConfirmed !== true) {
      return NextResponse.json({ ok: false, code: 'PHYSICAL_PROOF_REQUIRED', error: 'تأكيد تجربة الطباعة على XP-80 مطلوب قبل الاعتماد' }, { status: 400 });
    }
    const scope = branchScope(parseScope(body.scope), auth.activeBranchId);
    const version = await publishStudio(auth.tenantId, scope, auth.userId, body.expectedDraftRevision);
    return NextResponse.json({ ok: true, publishedVersion: version });
  } catch (e) {
    if (e instanceof StudioError) return NextResponse.json({ ok: false, code: e.code, error: e.message }, { status: e.status });
    console.error('[receipt-studio publish]', e);
    return NextResponse.json({ ok: false, error: 'تعذر اعتماد التصميم' }, { status: 500 });
  }
}

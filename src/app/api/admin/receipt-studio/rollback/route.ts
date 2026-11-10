import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import { branchScope, parseScope, rollbackStudio, StudioError } from '@/lib/receipt-studio/storage';

export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;
  try {
    const body = await req.json();
    const scope = branchScope(parseScope(body.scope), auth.activeBranchId);
    const version = await rollbackStudio(auth.tenantId, scope, auth.userId, body.version);
    return NextResponse.json({ ok: true, publishedVersion: version });
  } catch (e) {
    if (e instanceof StudioError) return NextResponse.json({ ok: false, code: e.code, error: e.message }, { status: e.status });
    console.error('[receipt-studio rollback]', e);
    return NextResponse.json({ ok: false, error: 'تعذر استعادة التصميم' }, { status: 500 });
  }
}

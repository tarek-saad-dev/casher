import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import {
  branchScope, parseScope, readStudioState, saveStudioDraft, assetUrisForTemplate, StudioError,
} from '@/lib/receipt-studio/storage';

export const runtime = 'nodejs';

function errorResponse(error: unknown) {
  if (error instanceof StudioError) return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.status });
  console.error('[receipt-studio] Unexpected failure', error);
  return NextResponse.json({ ok: false, code: 'SERVER_ERROR', error: 'تعذر الوصول لتصميم الفاتورة' }, { status: 500 });
}
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;
  try {
    const scope = branchScope(parseScope(req.nextUrl.searchParams.get('scope') ?? 'branch'), auth.activeBranchId);
    const state = await readStudioState(auth.tenantId, scope);
    const assets = await assetUrisForTemplate(auth.tenantId, state.draft);
    return NextResponse.json({ ok: true, scope, ...state, assets }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
export async function PUT(req: NextRequest) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;
  try {
    const body = await req.json();
    const scope = branchScope(parseScope(body.scope), auth.activeBranchId);
    const revision = await saveStudioDraft(auth.tenantId, scope, auth.userId, body.expectedRevision, body.template);
    return NextResponse.json({ ok: true, draftRevision: revision });
  } catch (error) { return errorResponse(error); }
}

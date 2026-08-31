import { NextResponse } from 'next/server';
import { requireAdmin, isAuthResult } from '@/lib/api-auth';
import { getControlPlaneStore, isAiControlPlanePhase1Enabled } from '@/modules/ai-control-plane';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  if (!isAiControlPlanePhase1Enabled()) {
    return NextResponse.json({ ok: false, error: 'feature_disabled' }, { status: 403 });
  }
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  const url = new URL(req.url);
  const submissionId = url.searchParams.get('submissionId');
  const store = await getControlPlaneStore();
  const artifacts = await store.listArtifacts({
    submissionId: submissionId ? Number(submissionId) : undefined,
  });
  return NextResponse.json({ ok: true, artifacts });
}

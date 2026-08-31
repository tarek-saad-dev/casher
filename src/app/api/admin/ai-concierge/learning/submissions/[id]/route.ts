import { NextResponse } from 'next/server';
import { requireAdmin, isAuthResult } from '@/lib/api-auth';
import { getControlPlaneStore, isAiControlPlanePhase1Enabled } from '@/modules/ai-control-plane';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  if (!isAiControlPlanePhase1Enabled()) {
    return NextResponse.json({ ok: false, error: 'feature_disabled' }, { status: 403 });
  }
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  const { id } = await params;
  const submissionId = Number(id);
  const store = await getControlPlaneStore();
  const submission = await store.getSubmission(submissionId);
  if (!submission) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  const artifacts = await store.listArtifacts({ submissionId });
  return NextResponse.json({ ok: true, submission, artifacts });
}

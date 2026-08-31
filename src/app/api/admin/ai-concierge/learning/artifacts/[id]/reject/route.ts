import { NextResponse } from 'next/server';
import { requireAdmin, isAuthResult } from '@/lib/api-auth';
import { getControlPlaneStore, isAiControlPlanePhase1Enabled, rejectArtifact } from '@/modules/ai-control-plane';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  if (!isAiControlPlanePhase1Enabled()) {
    return NextResponse.json({ ok: false, error: 'feature_disabled' }, { status: 403 });
  }
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  const body = (await req.json().catch(() => ({}))) as { reason?: string };
  const { id } = await params;
  const store = await getControlPlaneStore();
  const artifact = await rejectArtifact(store, Number(id), auth.userId, body.reason);
  return NextResponse.json({ ok: true, artifact });
}

import { NextResponse } from 'next/server';
import { requireAdmin, isAuthResult } from '@/lib/api-auth';
import { approveArtifact, getControlPlaneStore, isAiControlPlanePhase1Enabled } from '@/modules/ai-control-plane';
import { runWithStaffMessagingTenant } from '@/modules/messaging/tenancy/staffScope';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  if (!isAiControlPlanePhase1Enabled()) {
    return NextResponse.json({ ok: false, error: 'feature_disabled' }, { status: 403 });
  }
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;
  return runWithStaffMessagingTenant(auth, 'admin/ai-concierge/learning/artifacts/[id]/approve:POST', async () => {
    const { id } = await params;
    const artifactId = Number(id);
    const store = await getControlPlaneStore();
    try {
      const result = await approveArtifact(store, artifactId, auth.userId);
      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      return NextResponse.json({ ok: false, error: String(err), blocked: true }, { status: 409 });
    }
  });
}

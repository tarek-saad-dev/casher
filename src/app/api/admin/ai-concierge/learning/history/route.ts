import { NextResponse } from 'next/server';
import { requireAdmin, isAuthResult } from '@/lib/api-auth';
import { getControlPlaneStore, isAiControlPlanePhase1Enabled, listHistory } from '@/modules/ai-control-plane';
import { runWithStaffMessagingTenant } from '@/modules/messaging/tenancy/staffScope';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  if (!isAiControlPlanePhase1Enabled()) {
    return NextResponse.json({ ok: false, error: 'feature_disabled' }, { status: 403 });
  }
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;
  return runWithStaffMessagingTenant(auth, 'admin/ai-concierge/learning/history:GET', async () => {
    const url = new URL(req.url);
    const submissionId = url.searchParams.get('submissionId');
    const artifactId = url.searchParams.get('artifactId');
    const store = await getControlPlaneStore();
    const events = await listHistory(store, {
      submissionId: submissionId ? Number(submissionId) : undefined,
      artifactId: artifactId ? Number(artifactId) : undefined,
    });
    return NextResponse.json({ ok: true, events });
  });
}

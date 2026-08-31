import { NextResponse } from 'next/server';
import { requireAdmin, isAuthResult } from '@/lib/api-auth';
import {
  createLearningSubmission,
  getControlPlaneStore,
  isAiControlPlanePhase1Enabled,
} from '@/modules/ai-control-plane';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (!isAiControlPlanePhase1Enabled()) {
    return NextResponse.json({ ok: false, error: 'feature_disabled' }, { status: 403 });
  }
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  const body = (await req.json().catch(() => ({}))) as { rawInput?: string; contextJson?: unknown };
  const store = await getControlPlaneStore();
  try {
    const submission = await createLearningSubmission(store, {
      rawInput: body.rawInput ?? '',
      submittedByUserId: auth.userId,
      contextJson: body.contextJson,
    });
    return NextResponse.json({ ok: true, submission });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 400 });
  }
}

export async function GET() {
  if (!isAiControlPlanePhase1Enabled()) {
    return NextResponse.json({ ok: false, error: 'feature_disabled' }, { status: 403 });
  }
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;
  const store = await getControlPlaneStore();
  const submissions = await store.listSubmissions(50);
  return NextResponse.json({ ok: true, submissions });
}

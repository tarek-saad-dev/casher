import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, isAuthResult } from '@/lib/api-auth';
import { processConciergeTurn } from '@/modules/messaging/ai/salonConcierge/processConciergeTurn';
import { loadConciergeSnapshot } from '@/modules/messaging/ai/salonConcierge/hub';
import { DEFAULT_BRAND_VOICE } from '@/modules/messaging/ai/salonConcierge/defaults';
import type { BrandVoiceProfile } from '@/modules/messaging/ai/salonConcierge/types';

export const runtime = 'nodejs';

/**
 * POST /api/admin/salon-concierge/preview
 * Generates a concierge reply without mutating production conversations or gaps.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  const body = (await req.json().catch(() => ({}))) as {
    customerMessage?: string;
    brandVoice?: Partial<BrandVoiceProfile>;
  };
  const text = String(body.customerMessage || '').trim();
  if (!text) {
    return NextResponse.json({ error: 'customerMessage required' }, { status: 400 });
  }

  const prev = process.env.SALON_CONCIERGE_BRAIN_V1;
  process.env.SALON_CONCIERGE_BRAIN_V1 = 'true';
  try {
    const snapshot = await loadConciergeSnapshot({ includeInactive: false });
    if (body.brandVoice) {
      snapshot.brandVoice = { ...DEFAULT_BRAND_VOICE, ...snapshot.brandVoice, ...body.brandVoice };
    }
    const decision = await processConciergeTurn({
      text,
      skipGapCapture: true,
      snapshotOverride: snapshot,
    });
    return NextResponse.json({
      ok: true,
      preview: true,
      mutatesConversation: false,
      replyText: decision?.replyText ?? null,
      handled: Boolean(decision?.handled),
      passToPhase2: Boolean(decision?.passToPhase2),
      intent: decision?.trace.intent ?? null,
      answerSource: decision?.trace.answerSource ?? null,
      voiceExampleIds: decision?.trace.voiceExampleIds ?? [],
    });
  } finally {
    if (prev === undefined) delete process.env.SALON_CONCIERGE_BRAIN_V1;
    else process.env.SALON_CONCIERGE_BRAIN_V1 = prev;
  }
}

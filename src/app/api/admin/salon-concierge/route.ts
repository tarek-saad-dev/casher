import { NextResponse } from 'next/server';
import { requireAdmin, isAuthResult } from '@/lib/api-auth';
import { isConciergeTestHub } from '@/modules/messaging/ai/salonConcierge/defaults';
import { loadConciergeSnapshot } from '@/modules/messaging/ai/salonConcierge/hub';
import { listActiveOffers } from '@/modules/messaging/ai/salonConcierge/lookup';
import { listKnowledgeGaps } from '@/modules/messaging/ai/salonConcierge/knowledgeGaps';

export const runtime = 'nodejs';

/**
 * GET /api/admin/salon-concierge — knowledge hub snapshot (admin only).
 */
export async function GET() {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  const snapshot = await loadConciergeSnapshot({ includeInactive: true });
  let dbReady = isConciergeTestHub();
  let tables: Record<string, boolean> = {};
  if (!isConciergeTestHub()) {
    try {
      const { probeConciergeTables } = await import(
        '@/modules/messaging/ai/salonConcierge/sqlRepository'
      );
      const probe = await probeConciergeTables();
      dbReady = probe.ready;
      tables = probe.tables;
    } catch {
      dbReady = false;
    }
  }

  return NextResponse.json({
    ok: true,
    dbReady,
    tables,
    fixtureMode: isConciergeTestHub(),
    knowledge: snapshot.knowledge,
    capabilities: snapshot.capabilities,
    links: snapshot.links,
    offers: snapshot.offers,
    activeOffers: listActiveOffers(snapshot),
    brandVoice: snapshot.brandVoice,
    examples: snapshot.examples,
    sources: snapshot.sources,
    knowledgeGaps: isConciergeTestHub() ? listKnowledgeGaps() : snapshot.gaps,
  });
}

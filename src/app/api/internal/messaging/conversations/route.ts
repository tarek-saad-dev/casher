import { NextRequest, NextResponse } from 'next/server';
import {
  isSystemJobAuthResult,
  requireSystemJobAuth,
} from '@/lib/api-auth';
import { listConversations } from '@/modules/messaging/conversation/application/listConversations';
import { runWithSystemJobMessagingTenant } from '@/modules/messaging/tenancy/systemJobScope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/internal/messaging/conversations
 * Operational conversation list (newest activity first) for one tenant.
 */
export async function GET(req: NextRequest) {
  const jobAuth = await requireSystemJobAuth(req);
  if (!isSystemJobAuthResult(jobAuth)) return jobAuth;

  return runWithSystemJobMessagingTenant(jobAuth, req, 'internal/messaging/conversations:GET', async () => {
    try {
      const { searchParams } = req.nextUrl;
      const limitRaw = searchParams.get('limit');
      const limit = limitRaw == null ? undefined : Number(limitRaw);
      const result = await listConversations({ limit });
      return NextResponse.json({ ok: true, items: result.items, limit: result.limit });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[api/internal/messaging/conversations] error:', message);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  });
}

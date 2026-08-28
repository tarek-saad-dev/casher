import { NextRequest, NextResponse } from 'next/server';
import {
  isSystemJobAuthResult,
  requireSystemJobAuth,
} from '@/lib/api-auth';
import { listConversationMessages } from '@/modules/messaging/conversation/application/listConversationMessages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/internal/messaging/conversations/:id/messages
 */
export async function GET(req: NextRequest, context: RouteContext) {
  const jobAuth = await requireSystemJobAuth(req);
  if (!isSystemJobAuthResult(jobAuth)) return jobAuth;

  try {
    const { id } = await context.params;
    const conversationId = Number(id);
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      return NextResponse.json({ ok: false, error: 'Invalid conversation id' }, { status: 400 });
    }

    const { searchParams } = req.nextUrl;
    const limitRaw = searchParams.get('limit');
    const limit = limitRaw == null ? undefined : Number(limitRaw);
    const result = await listConversationMessages({ conversationId, limit });
    if (!result.conversation) {
      return NextResponse.json({ ok: false, error: 'Conversation not found' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      conversationId: result.conversation.conversationId,
      items: result.items,
      limit: result.limit,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/internal/messaging/conversations/:id/messages] error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

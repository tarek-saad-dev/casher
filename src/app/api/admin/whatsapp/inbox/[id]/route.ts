import { NextRequest, NextResponse } from 'next/server';
import { getUserFriendlyError } from '@/lib/db';
import {
  isWhatsAppTemplateAdmin,
  requireWhatsAppTemplateAdmin,
} from '@/app/api/admin/whatsapp/templates/access';
import { getWhatsAppInboxConversation } from '@/modules/messaging/handoff/application/listInbox';
import { ownershipLabel } from '@/modules/messaging/handoff/domain/inboxRanking';
import {
  getDrvowaInboxConversation,
  isDrvowaEventMessagingActive,
} from '@/lib/integrations/drvowaClient';
import { enrichDrvowaInboxContacts } from '@/lib/integrations/drvowaInboxEnrichment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/whatsapp/inbox/[id]?afterMessageId=
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const admin = await requireWhatsAppTemplateAdmin();
  if (!isWhatsAppTemplateAdmin(admin)) return admin;

  try {
    const { id } = await ctx.params;

    if (await isDrvowaEventMessagingActive()) {
      const url = new URL(req.url);
      const beforeAt = url.searchParams.get('beforeAt');
      const beforeCreatedAt = url.searchParams.get('beforeCreatedAt');
      const beforeMessageId = url.searchParams.get('beforeMessageId');
      const before =
        beforeAt && beforeCreatedAt && beforeMessageId
          ? { beforeAt, beforeCreatedAt, beforeMessageId }
          : null;

      const remote = await getDrvowaInboxConversation(id, 100, before);
      if (!remote) return NextResponse.json({ error: 'not found' }, { status: 404 });

      const [enriched] = await enrichDrvowaInboxContacts([remote]);
      const mode =
        remote.aiMode === 'HUMAN_PAUSED'
          ? 'HUMAN'
          : remote.aiMode === 'SAFETY_PAUSED'
            ? 'PAUSED'
            : 'BOT';

      return NextResponse.json({
        ok: true,
        source: 'DRVOWA',
        conversation: {
          conversationId: remote.conversationId,
          phone: enriched?.erpPhone || remote.phone,
          displayName: enriched?.erpCustomerName || remote.displayName,
          erpClientId: enriched?.erpClientId ?? null,
          lastMessagePreview: remote.lastMessagePreview,
          lastMessageAt: remote.lastMessageAt,
          unreadCount: remote.needsReply ? 1 : 0,
          mode,
          takeoverSource: mode === 'HUMAN' ? 'ERP' : null,
          takenOverByUserId: null,
          takenOverByName: mode === 'HUMAN' ? 'موظف' : null,
          controlVersion: 1,
          humanLeaseUntil: null,
          messages: remote.messages,
          pageInfo: remote.pageInfo ?? { hasMore: false, nextCursor: null },
          ownershipLabel:
            mode === 'HUMAN'
              ? 'مع موظف'
              : mode === 'PAUSED'
                ? 'متوقف'
                : 'الـ AI',
        },
      });
    }

    const conversationId = Number(id);
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      return NextResponse.json({ error: 'invalid id' }, { status: 400 });
    }
    const after = Number(new URL(req.url).searchParams.get('afterMessageId') || 0);
    const detail = await getWhatsAppInboxConversation({
      conversationId,
      afterMessageId: after > 0 ? after : null,
    });
    if (!detail) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({
      ok: true,
      conversation: {
        ...detail,
        ownershipLabel: ownershipLabel(detail),
      },
    });
  } catch (err) {
    console.error('[api/admin/whatsapp/inbox/[id] GET]', err);
    return NextResponse.json({ error: getUserFriendlyError(err) }, { status: 500 });
  }
}

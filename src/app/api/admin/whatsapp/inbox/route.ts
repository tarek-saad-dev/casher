import { NextRequest, NextResponse } from 'next/server';
import { getUserFriendlyError } from '@/lib/db';
import {
  isWhatsAppTemplateAdmin,
  requireWhatsAppTemplateAdmin,
} from '@/app/api/admin/whatsapp/templates/access';
import { listWhatsAppInbox } from '@/modules/messaging/handoff/application/listInbox';
import {
  matchesInboxFilter,
  matchesInboxSearch,
  sortInboxItems,
  type InboxFilter,
  type InboxListItem,
} from '@/modules/messaging/handoff/domain/inboxRanking';
import {
  isDrvowaEventMessagingActive,
  listDrvowaInboxConversations,
} from '@/lib/integrations/drvowaClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/whatsapp/inbox?filter=&q=&limit=
 */
export async function GET(req: NextRequest) {
  const admin = await requireWhatsAppTemplateAdmin();
  if (!isWhatsAppTemplateAdmin(admin)) return admin;

  try {
    const { searchParams } = new URL(req.url);
    const filter = (searchParams.get('filter') || 'all') as InboxFilter;
    const q = searchParams.get('q') || '';
    const limit = Number(searchParams.get('limit') || 80);
    if (await isDrvowaEventMessagingActive()) {
      const remote = await listDrvowaInboxConversations(limit);
      const mapped: InboxListItem[] = remote.map((item) => {
        const human = item.aiMode === 'HUMAN_PAUSED';
        const paused = item.aiMode === 'SAFETY_PAUSED';
        return {
          conversationId: item.conversationId,
          phone: item.phone,
          displayName: item.displayName,
          lastMessagePreview: item.lastMessagePreview,
          lastMessageAt: item.lastMessageAt,
          unreadCount: 0,
          mode: human ? 'HUMAN' : paused ? 'PAUSED' : 'BOT',
          takeoverSource: human ? 'ERP' : null,
          takenOverByUserId: null,
          takenOverByName: human ? 'موظف' : null,
          controlVersion: 1,
        };
      });
      const items = sortInboxItems(
        mapped.filter(
          (item) =>
            matchesInboxFilter(item, filter)
            && matchesInboxSearch(item, q),
        ),
      );
      return NextResponse.json({ ok: true, source: 'DRVOWA', items });
    }

    const result = await listWhatsAppInbox({ filter, q, limit });
    return NextResponse.json({ ok: true, source: 'LOCAL', ...result });
  } catch (err) {
    console.error('[api/admin/whatsapp/inbox GET]', err);
    return NextResponse.json({ error: getUserFriendlyError(err) }, { status: 500 });
  }
}

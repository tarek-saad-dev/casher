import { NextRequest, NextResponse } from 'next/server';
import { getUserFriendlyError } from '@/lib/db';
import {
  isWhatsAppTemplateAdmin,
  requireWhatsAppTemplateAdmin,
} from '@/app/api/admin/whatsapp/templates/access';
import {
  takeoverConversationErp,
  withControlDeps,
} from '@/modules/messaging/handoff/application/commands';
import { resolveUserDisplayName } from '@/modules/messaging/handoff/application/listInbox';
import { HandoffError } from '@/modules/messaging/handoff/application/errors';
import { ownershipLabel } from '@/modules/messaging/handoff/domain/inboxRanking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  const admin = await requireWhatsAppTemplateAdmin();
  if (!isWhatsAppTemplateAdmin(admin)) return admin;

  try {
    const { id } = await ctx.params;
    const conversationId = Number(id);
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      return NextResponse.json({ error: 'invalid id' }, { status: 400 });
    }
    const state = await takeoverConversationErp(
      { conversationId, userId: admin.userId },
      withControlDeps({ resolveUserName: resolveUserDisplayName }),
    );
    const ownerName = state.takenOverByUserId
      ? await resolveUserDisplayName(state.takenOverByUserId)
      : null;
    return NextResponse.json({
      ok: true,
      control: state,
      ownershipLabel: ownershipLabel({
        conversationId: state.conversationId,
        phone: '',
        displayName: null,
        lastMessagePreview: null,
        lastMessageAt: new Date().toISOString(),
        unreadCount: state.unreadCount,
        mode: state.mode,
        takeoverSource: state.takeoverSource,
        takenOverByUserId: state.takenOverByUserId,
        takenOverByName: ownerName,
        controlVersion: state.controlVersion,
      }),
    });
  } catch (err) {
    if (err instanceof HandoffError) {
      return NextResponse.json(
        { ok: false, error: err.message, code: err.code, ownerName: err.ownerName },
        { status: err.status },
      );
    }
    console.error('[api/admin/whatsapp/inbox/[id]/takeover POST]', err);
    return NextResponse.json({ error: getUserFriendlyError(err) }, { status: 500 });
  }
}

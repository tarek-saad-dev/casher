import { NextRequest, NextResponse } from 'next/server';
import { getUserFriendlyError } from '@/lib/db';
import {
  isWhatsAppTemplateAdmin,
  requireWhatsAppTemplateAdmin,
} from '@/app/api/admin/whatsapp/templates/access';
import { withControlDeps } from '@/modules/messaging/handoff/application/commands';
import { sendHumanErpMessage } from '@/modules/messaging/handoff/application/sendHumanErp';
import { resolveUserDisplayName } from '@/modules/messaging/handoff/application/listInbox';
import { HandoffError } from '@/modules/messaging/handoff/application/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const admin = await requireWhatsAppTemplateAdmin();
  if (!isWhatsAppTemplateAdmin(admin)) return admin;

  try {
    const { id } = await ctx.params;
    const conversationId = Number(id);
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      return NextResponse.json({ error: 'invalid id' }, { status: 400 });
    }
    const body = (await req.json()) as { text?: string };
    const result = await sendHumanErpMessage(
      {
        conversationId,
        userId: admin.userId,
        text: String(body.text ?? ''),
        branchId: admin.branchId,
      },
      withControlDeps({ resolveUserName: resolveUserDisplayName }),
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof HandoffError) {
      return NextResponse.json(
        { ok: false, error: err.message, code: err.code, ownerName: err.ownerName },
        { status: err.status },
      );
    }
    console.error('[api/admin/whatsapp/inbox/[id]/send POST]', err);
    return NextResponse.json({ error: getUserFriendlyError(err) }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getUserFriendlyError } from '@/lib/db';
import {
  WhatsAppGroupError,
  deleteWhatsAppGroup,
  getWhatsAppGroupById,
  updateWhatsAppGroup,
  sendTestGroupMessage,
} from '@/modules/messaging/groups';
import {
  isWhatsAppTemplateAdmin,
  requireWhatsAppTemplateAdmin,
} from '../../templates/access';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/whatsapp/groups/[id]
 */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const admin = await requireWhatsAppTemplateAdmin();
  if (!isWhatsAppTemplateAdmin(admin)) return admin;

  try {
    const { id } = await ctx.params;
    const groupId = Number(id);
    if (!Number.isFinite(groupId)) {
      return NextResponse.json({ error: 'معرّف غير صالح' }, { status: 400 });
    }
    const group = await getWhatsAppGroupById(groupId);
    if (!group) {
      return NextResponse.json({ error: 'الجروب غير موجود' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, group });
  } catch (err) {
    console.error('[api/admin/whatsapp/groups/[id] GET]', err);
    return NextResponse.json({ error: getUserFriendlyError(err) }, { status: 500 });
  }
}

/**
 * PUT /api/admin/whatsapp/groups/[id]
 */
export async function PUT(req: NextRequest, ctx: RouteContext) {
  const admin = await requireWhatsAppTemplateAdmin();
  if (!isWhatsAppTemplateAdmin(admin)) return admin;

  try {
    const { id } = await ctx.params;
    const groupId = Number(id);
    if (!Number.isFinite(groupId)) {
      return NextResponse.json({ error: 'معرّف غير صالح' }, { status: 400 });
    }

    const body = (await req.json()) as {
      name?: string;
      inviteLink?: string;
      subscribedEvents?: string[];
      branchId?: number | null;
      isActive?: boolean;
    };

    const group = await updateWhatsAppGroup(groupId, {
      name: String(body.name ?? ''),
      inviteLink: String(body.inviteLink ?? ''),
      subscribedEvents: body.subscribedEvents ?? [],
      branchId: body.branchId ?? null,
      isActive: body.isActive !== false,
    });

    return NextResponse.json({ ok: true, group });
  } catch (err) {
    if (err instanceof WhatsAppGroupError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[api/admin/whatsapp/groups/[id] PUT]', err);
    return NextResponse.json({ error: getUserFriendlyError(err) }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/whatsapp/groups/[id]
 */
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const admin = await requireWhatsAppTemplateAdmin();
  if (!isWhatsAppTemplateAdmin(admin)) return admin;

  try {
    const { id } = await ctx.params;
    const groupId = Number(id);
    if (!Number.isFinite(groupId)) {
      return NextResponse.json({ error: 'معرّف غير صالح' }, { status: 400 });
    }
    await deleteWhatsAppGroup(groupId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof WhatsAppGroupError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[api/admin/whatsapp/groups/[id] DELETE]', err);
    return NextResponse.json({ error: getUserFriendlyError(err) }, { status: 500 });
  }
}

/**
 * POST /api/admin/whatsapp/groups/[id] — test send
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const admin = await requireWhatsAppTemplateAdmin();
  if (!isWhatsAppTemplateAdmin(admin)) return admin;

  try {
    const { id } = await ctx.params;
    const groupId = Number(id);
    if (!Number.isFinite(groupId)) {
      return NextResponse.json({ error: 'معرّف غير صالح' }, { status: 400 });
    }

    const body = (await req.json()) as { message?: string };
    const message =
      typeof body.message === 'string' && body.message.trim()
        ? body.message.trim()
        : 'اختبار إرسال من نظام Cut Salon ✅';

    const result = await sendTestGroupMessage(groupId, message);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error('[api/admin/whatsapp/groups/[id] POST]', err);
    return NextResponse.json({ error: getUserFriendlyError(err) }, { status: 500 });
  }
}

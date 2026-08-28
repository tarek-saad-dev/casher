import { NextRequest, NextResponse } from 'next/server';
import { getUserFriendlyError } from '@/lib/db';
import {
  WhatsAppGroupError,
  createWhatsAppGroup,
  listWhatsAppGroups,
  WHATSAPP_GROUP_EVENTS,
} from '@/modules/messaging/groups';
import {
  isWhatsAppTemplateAdmin,
  requireWhatsAppTemplateAdmin,
} from '../templates/access';

export const runtime = 'nodejs';

/**
 * GET /api/admin/whatsapp/groups
 */
export async function GET() {
  const admin = await requireWhatsAppTemplateAdmin();
  if (!isWhatsAppTemplateAdmin(admin)) return admin;

  try {
    const groups = await listWhatsAppGroups();
    return NextResponse.json({
      ok: true,
      groups,
      events: WHATSAPP_GROUP_EVENTS,
    });
  } catch (err) {
    if (err instanceof WhatsAppGroupError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[api/admin/whatsapp/groups GET]', err);
    return NextResponse.json({ error: getUserFriendlyError(err) }, { status: 500 });
  }
}

/**
 * POST /api/admin/whatsapp/groups
 */
export async function POST(req: NextRequest) {
  const admin = await requireWhatsAppTemplateAdmin();
  if (!isWhatsAppTemplateAdmin(admin)) return admin;

  try {
    const body = (await req.json()) as {
      name?: string;
      inviteLink?: string;
      subscribedEvents?: string[];
      branchId?: number | null;
      isActive?: boolean;
    };

    const group = await createWhatsAppGroup({
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
    console.error('[api/admin/whatsapp/groups POST]', err);
    return NextResponse.json({ error: getUserFriendlyError(err) }, { status: 500 });
  }
}

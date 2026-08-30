import { NextRequest, NextResponse } from 'next/server';
import { getUserFriendlyError } from '@/lib/db';
import {
  isWhatsAppTemplateAdmin,
  requireWhatsAppTemplateAdmin,
} from '@/app/api/admin/whatsapp/templates/access';
import { listWhatsAppInbox } from '@/modules/messaging/handoff/application/listInbox';
import type { InboxFilter } from '@/modules/messaging/handoff/domain/inboxRanking';

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
    const result = await listWhatsAppInbox({ filter, q, limit });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[api/admin/whatsapp/inbox GET]', err);
    return NextResponse.json({ error: getUserFriendlyError(err) }, { status: 500 });
  }
}

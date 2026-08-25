import { NextResponse } from 'next/server';
import { getUserFriendlyError } from '@/lib/db';
import { CampaignError, getCampaign } from '@/modules/messaging/campaigns';
import {
  isWhatsAppTemplateAdmin,
  requireWhatsAppTemplateAdmin,
} from '../../templates/access';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/whatsapp/campaigns/[id]
 */
export async function GET(_req: Request, context: RouteContext) {
  const admin = await requireWhatsAppTemplateAdmin();
  if (!isWhatsAppTemplateAdmin(admin)) return admin;

  try {
    const { id } = await context.params;
    const campaignId = Number(id);
    if (!Number.isFinite(campaignId)) {
      return NextResponse.json({ error: 'معرّف الحملة غير صالح' }, { status: 400 });
    }

    const campaign = await getCampaign(campaignId, { sync: true });
    return NextResponse.json({ ok: true, campaign });
  } catch (err) {
    if (err instanceof CampaignError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[api/admin/whatsapp/campaigns/[id] GET]', err);
    return NextResponse.json({ error: getUserFriendlyError(err) }, { status: 500 });
  }
}

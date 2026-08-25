import { NextRequest, NextResponse } from 'next/server';
import { getUserFriendlyError } from '@/lib/db';
import {
  CampaignError,
  createCampaign,
  listCampaigns,
  type AudienceCriteria,
} from '@/modules/messaging/campaigns';
import {
  isWhatsAppTemplateAdmin,
  requireWhatsAppTemplateAdmin,
} from '../templates/access';

export const runtime = 'nodejs';

/**
 * GET /api/admin/whatsapp/campaigns
 */
export async function GET() {
  const admin = await requireWhatsAppTemplateAdmin();
  if (!isWhatsAppTemplateAdmin(admin)) return admin;

  try {
    const campaigns = await listCampaigns();
    return NextResponse.json({ ok: true, campaigns });
  } catch (err) {
    if (err instanceof CampaignError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[api/admin/whatsapp/campaigns GET]', err);
    return NextResponse.json({ error: getUserFriendlyError(err) }, { status: 500 });
  }
}

/**
 * POST /api/admin/whatsapp/campaigns — create draft campaign
 */
export async function POST(req: NextRequest) {
  const admin = await requireWhatsAppTemplateAdmin();
  if (!isWhatsAppTemplateAdmin(admin)) return admin;

  try {
    const body = (await req.json()) as {
      name?: string;
      messageMode?: string;
      templateKey?: string | null;
      customMessage?: string | null;
      audience?: AudienceCriteria;
      branchId?: number | null;
      scheduledAt?: string | null;
    };

    const campaign = await createCampaign({
      name: String(body.name ?? ''),
      messageMode: String(body.messageMode ?? ''),
      templateKey: body.templateKey ?? null,
      customMessage: body.customMessage ?? null,
      audience: body.audience as AudienceCriteria,
      branchId: body.branchId ?? admin.branchId,
      scheduledAt: body.scheduledAt ?? null,
      createdByUserId: admin.userId,
    });

    return NextResponse.json({ ok: true, campaign });
  } catch (err) {
    if (err instanceof CampaignError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[api/admin/whatsapp/campaigns POST]', err);
    return NextResponse.json({ error: getUserFriendlyError(err) }, { status: 500 });
  }
}

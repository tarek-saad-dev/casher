import { NextRequest, NextResponse } from 'next/server';
import { getUserFriendlyError } from '@/lib/db';
import {
  CampaignError,
  previewCampaignMessage,
  type CampaignMessageMode,
} from '@/modules/messaging/campaigns';
import {
  isWhatsAppTemplateAdmin,
  requireWhatsAppTemplateAdmin,
} from '../../../templates/access';

export const runtime = 'nodejs';

/**
 * POST /api/admin/whatsapp/campaigns/message/preview
 */
export async function POST(req: NextRequest) {
  const admin = await requireWhatsAppTemplateAdmin();
  if (!isWhatsAppTemplateAdmin(admin)) return admin;

  try {
    const body = (await req.json()) as {
      messageMode?: CampaignMessageMode;
      templateKey?: string | null;
      customMessage?: string | null;
      sampleName?: string;
    };

    const rendered = await previewCampaignMessage({
      messageMode: body.messageMode ?? 'template',
      templateKey: body.templateKey ?? null,
      customMessage: body.customMessage ?? null,
      sampleName: body.sampleName,
      branchId: admin.branchId,
    });

    return NextResponse.json({ ok: true, rendered });
  } catch (err) {
    if (err instanceof CampaignError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[api/admin/whatsapp/campaigns/message/preview POST]', err);
    return NextResponse.json({ error: getUserFriendlyError(err) }, { status: 500 });
  }
}

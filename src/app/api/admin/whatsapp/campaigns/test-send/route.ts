import { NextRequest, NextResponse } from 'next/server';
import { getUserFriendlyError } from '@/lib/db';
import {
  CampaignError,
  testSendCampaignMessage,
  type CampaignMessageMode,
} from '@/modules/messaging/campaigns';
import {
  isWhatsAppTemplateAdmin,
  requireWhatsAppTemplateAdmin,
} from '../../templates/access';
import { runWithStaffMessagingTenant } from '@/modules/messaging/tenancy/staffScope';

export const runtime = 'nodejs';

/**
 * POST /api/admin/whatsapp/campaigns/test-send
 * Sends one test message to an authorized admin phone (WHATSAPP_CAMPAIGN_TEST_PHONES).
 */
export async function POST(req: NextRequest) {
  const admin = await requireWhatsAppTemplateAdmin();
  if (!isWhatsAppTemplateAdmin(admin)) return admin;
  return runWithStaffMessagingTenant(admin, 'admin/whatsapp/campaigns/test-send:POST', async () => {
    try {
      const body = (await req.json()) as {
        phone?: string;
        messageMode?: CampaignMessageMode;
        templateKey?: string | null;
        customMessage?: string | null;
        sampleName?: string;
        sampleBranchName?: string | null;
      };

      const result = await testSendCampaignMessage({
        phone: String(body.phone ?? ''),
        messageMode: body.messageMode ?? 'template',
        templateKey: body.templateKey ?? null,
        customMessage: body.customMessage ?? null,
        sampleName: body.sampleName,
        sampleBranchName: body.sampleBranchName,
        branchId: admin.branchId,
        userId: admin.userId,
      });

      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      if (err instanceof CampaignError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      }
      console.error('[api/admin/whatsapp/campaigns/test-send POST]', err);
      return NextResponse.json({ error: getUserFriendlyError(err) }, { status: 500 });
    }
  });
}

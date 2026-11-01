import { NextRequest, NextResponse } from 'next/server';
import { getUserFriendlyError } from '@/lib/db';
import { CampaignError, startCampaign } from '@/modules/messaging/campaigns';
import {
  isWhatsAppTemplateAdmin,
  requireWhatsAppTemplateAdmin,
} from '../../../templates/access';
import { runWithStaffMessagingTenant } from '@/modules/messaging/tenancy/staffScope';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/whatsapp/campaigns/[id]/start
 * Body: { explicitApproval?: boolean } — required true for NOV-PRO600
 */
export async function POST(req: NextRequest, context: RouteContext) {
  const admin = await requireWhatsAppTemplateAdmin();
  if (!isWhatsAppTemplateAdmin(admin)) return admin;
  return runWithStaffMessagingTenant(admin, 'admin/whatsapp/campaigns/[id]/start:POST', async () => {
    try {
      const { id } = await context.params;
      const campaignId = Number(id);
      if (!Number.isFinite(campaignId)) {
        return NextResponse.json({ error: 'معرّف الحملة غير صالح' }, { status: 400 });
      }

      let explicitApproval = false;
      try {
        const body = (await req.json()) as { explicitApproval?: boolean };
        explicitApproval = body?.explicitApproval === true;
      } catch {
        explicitApproval = false;
      }

      const result = await startCampaign({
        campaignId,
        userId: admin.userId,
        explicitApproval,
      });
      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      if (err instanceof CampaignError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      }
      console.error('[api/admin/whatsapp/campaigns/[id]/start POST]', err);
      return NextResponse.json({ error: getUserFriendlyError(err) }, { status: 500 });
    }
  });
}

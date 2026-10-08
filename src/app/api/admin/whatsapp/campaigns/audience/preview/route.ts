import { NextRequest, NextResponse } from 'next/server';
import { getUserFriendlyError } from '@/lib/db';
import {
  CampaignError,
  previewCampaignAudience,
  type AudienceCriteria,
} from '@/modules/messaging/campaigns';
import {
  isWhatsAppTemplateAdmin,
  requireWhatsAppTemplateAdmin,
} from '../../../templates/access';
import { runWithStaffMessagingTenant } from '@/modules/messaging/tenancy/staffScope';

export const runtime = 'nodejs';

/**
 * POST /api/admin/whatsapp/campaigns/audience/preview
 */
export async function POST(req: NextRequest) {
  const admin = await requireWhatsAppTemplateAdmin();
  if (!isWhatsAppTemplateAdmin(admin)) return admin;
  return runWithStaffMessagingTenant(admin, 'admin/whatsapp/campaigns/audience/preview:POST', async () => {
    try {
      const body = (await req.json()) as AudienceCriteria & { branchId?: number };
      const criteria: AudienceCriteria = {
        ...body,
        branchId: body.branchId ?? admin.branchId,
      };

      const preview = await previewCampaignAudience(criteria);
      return NextResponse.json({ ok: true, preview });
    } catch (err) {
      if (err instanceof CampaignError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      }
      console.error('[api/admin/whatsapp/campaigns/audience/preview POST]', err);
      return NextResponse.json({ error: getUserFriendlyError(err) }, { status: 500 });
    }
  });
}

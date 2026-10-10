import { NextResponse } from 'next/server';
import {
  isWhatsAppTemplateAdmin,
  requireWhatsAppTemplateAdmin,
} from '@/app/api/admin/whatsapp/templates/access';
import { isWhatsAppEnabled, getWhatsAppConfig } from '@/lib/integrations/whatsapp';
import { runWithStaffMessagingTenant } from '@/modules/messaging/tenancy/staffScope';
import {
  resolveCurrentTenantChannel,
  tenantChannelHealth,
  tenantChannelStatus,
} from '@/modules/messaging/tenancy/transport';

export const runtime = 'nodejs';

/**
 * GET /api/admin/whatsapp/status
 * Admin WhatsApp page connectivity probe (same ACL as templates).
 * Probes the signed-in tenant's own channel — never another tenant's bridge.
 */
export async function GET() {
  const auth = await requireWhatsAppTemplateAdmin();
  if (!isWhatsAppTemplateAdmin(auth)) return auth;
  return runWithStaffMessagingTenant(auth, 'admin/whatsapp/status:GET', async () => {
    const cfg = getWhatsAppConfig();
    const channel = await resolveCurrentTenantChannel('admin/whatsapp/status');
    const [status, botHealth] = await Promise.all([tenantChannelStatus(), tenantChannelHealth()]);

    return NextResponse.json({
      integrationEnabled: isWhatsAppEnabled(),
      apiBaseUrl: channel?.endpointUrl ?? null,
      channelConfigured: channel !== null,
      saleEnabled: cfg.saleEnabled,
      bookingEnabled: cfg.bookingEnabled,
      firstTimeEnabled: cfg.firstTimeEnabled,
      botHealth,
      status,
    });
  });
}

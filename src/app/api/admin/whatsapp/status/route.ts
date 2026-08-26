import { NextResponse } from 'next/server';
import {
  isWhatsAppTemplateAdmin,
  requireWhatsAppTemplateAdmin,
} from '@/app/api/admin/whatsapp/templates/access';
import {
  checkWhatsAppStatus,
  checkWhatsAppBotHealth,
  isWhatsAppEnabled,
  getWhatsAppConfig,
} from '@/lib/integrations/whatsapp';

export const runtime = 'nodejs';

/**
 * GET /api/admin/whatsapp/status
 * Admin WhatsApp page connectivity probe (same ACL as templates).
 * Maps Pure Gateway Phase 8 health + status — no typed-bot fields.
 */
export async function GET() {
  const auth = await requireWhatsAppTemplateAdmin();
  if (!isWhatsAppTemplateAdmin(auth)) return auth;

  const cfg = getWhatsAppConfig();
  const [status, botHealth] = await Promise.all([
    checkWhatsAppStatus(),
    checkWhatsAppBotHealth(),
  ]);

  return NextResponse.json({
    integrationEnabled: isWhatsAppEnabled(),
    apiBaseUrl: cfg.apiBaseUrl,
    saleEnabled: cfg.saleEnabled,
    bookingEnabled: cfg.bookingEnabled,
    firstTimeEnabled: cfg.firstTimeEnabled,
    botHealth,
    status,
  });
}

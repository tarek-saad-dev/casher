import { NextResponse } from 'next/server';
import { isAuthResult, requireDevelopmentAdmin } from '@/lib/api-auth';
import {
  checkWhatsAppStatus,
  checkWhatsAppBotHealth,
  isWhatsAppEnabled,
  getWhatsAppConfig,
} from '@/lib/integrations/whatsapp';

export const runtime = 'nodejs';

/**
 * GET /api/admin/whatsapp/status
 * Development-only diagnostics endpoint.
 * Returns normalized WhatsApp status without exposing sensitive server details.
 */
export async function GET() {
  const auth = await requireDevelopmentAdmin();
  if (!isAuthResult(auth)) return auth;

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

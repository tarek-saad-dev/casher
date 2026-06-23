import { NextResponse } from 'next/server';
import { checkWhatsAppStatus, isWhatsAppEnabled, getWhatsAppConfig } from '@/lib/integrations/whatsapp';

export const runtime = 'nodejs';

/**
 * GET /api/admin/whatsapp/status
 * Development-only diagnostics endpoint.
 * Returns normalized WhatsApp status without exposing sensitive server details.
 */
export async function GET() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(
      { available: false, reason: 'development_only' },
      { status: 200 },
    );
  }

  const cfg = getWhatsAppConfig();
  const status = await checkWhatsAppStatus();

  return NextResponse.json({
    integrationEnabled: isWhatsAppEnabled(),
    apiBaseUrl: cfg.apiBaseUrl,
    saleEnabled: cfg.saleEnabled,
    bookingEnabled: cfg.bookingEnabled,
    firstTimeEnabled: cfg.firstTimeEnabled,
    status,
  });
}

import { NextRequest, NextResponse } from 'next/server';
import {
  isWhatsAppInboxWebhookAuthResult,
  requireWhatsAppInboxWebhookAuth,
} from '@/modules/messaging/inbox/auth';
import { observeManualOutbound } from '@/modules/messaging/handoff/application/observeManualOutbound';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body = {
  provider?: unknown;
  providerMessageId?: unknown;
  phone?: unknown;
  text?: unknown;
  occurredAt?: unknown;
  rawPayload?: unknown;
};

/**
 * POST /api/internal/messaging/outbound-observed/whatsapp
 *
 * Baileys fromMe observation from the WhatsApp gateway.
 * Auth: Authorization: Bearer $WHATSAPP_INBOX_WEBHOOK_TOKEN
 */
export async function POST(req: NextRequest) {
  const auth = requireWhatsAppInboxWebhookAuth(req);
  if (!isWhatsAppInboxWebhookAuthResult(auth)) return auth;

  try {
    const body = (await req.json()) as Body;
    const providerMessageId = String(body.providerMessageId ?? '').trim();
    const phone = String(body.phone ?? '').trim();
    if (!providerMessageId || !phone) {
      return NextResponse.json(
        { ok: false, error: 'providerMessageId and phone are required' },
        { status: 400 },
      );
    }
    const result = await observeManualOutbound({
      provider: typeof body.provider === 'string' ? body.provider : undefined,
      providerMessageId,
      phone,
      text: body.text == null ? null : String(body.text),
      occurredAt:
        typeof body.occurredAt === 'string' || body.occurredAt instanceof Date
          ? body.occurredAt
          : undefined,
      rawPayload: body.rawPayload,
    });
    return NextResponse.json({ ok: true, ...result }, { status: result.duplicate ? 200 : 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/internal/messaging/outbound-observed/whatsapp]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

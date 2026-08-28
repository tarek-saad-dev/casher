import { NextRequest, NextResponse } from 'next/server';
import {
  isWhatsAppInboxWebhookAuthResult,
  requireWhatsAppInboxWebhookAuth,
} from '@/modules/messaging/inbox/auth';
import { ingestIncomingMessage } from '@/modules/messaging/inbox/application/ingestIncomingMessage';
import { MessageInboxError } from '@/modules/messaging/inbox/domain/types';
import {
  extractAdapterCorrelation,
  InboxWebhookPerfTimer,
  logInboxWebhookPerf,
} from '@/modules/messaging/inbox/observability/inboxWebhookPerf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type WhatsAppInboxBody = {
  provider?: unknown;
  providerMessageId?: unknown;
  phone?: unknown;
  chatTitle?: unknown;
  messageType?: unknown;
  text?: unknown;
  isGroup?: unknown;
  receivedAt?: unknown;
  rawPayload?: unknown;
};

function parseBody(body: WhatsAppInboxBody) {
  return {
    provider: typeof body.provider === 'string' ? body.provider : String(body.provider ?? ''),
    providerMessageId:
      typeof body.providerMessageId === 'string'
        ? body.providerMessageId
        : String(body.providerMessageId ?? ''),
    phone: typeof body.phone === 'string' ? body.phone : String(body.phone ?? ''),
    chatTitle:
      body.chatTitle == null
        ? null
        : typeof body.chatTitle === 'string'
          ? body.chatTitle
          : String(body.chatTitle),
    messageType:
      typeof body.messageType === 'string' ? body.messageType : String(body.messageType ?? ''),
    text:
      body.text == null
        ? null
        : typeof body.text === 'string'
          ? body.text
          : String(body.text),
    isGroup: Boolean(body.isGroup),
    receivedAt:
      typeof body.receivedAt === 'string' || body.receivedAt instanceof Date
        ? body.receivedAt
        : String(body.receivedAt ?? ''),
    rawPayload: body.rawPayload,
  };
}

function logPerf(input: {
  timer: InboxWebhookPerfTimer;
  provider: string;
  providerMessageId: string;
  inboxId?: number | null;
  duplicate: boolean;
  httpStatus: number;
  errorCode?: string | null;
  adapterCorrelation?: ReturnType<typeof extractAdapterCorrelation>;
}): void {
  logInboxWebhookPerf({
    timer: input.timer,
    provider: input.provider,
    providerMessageId: input.providerMessageId,
    inboxId: input.inboxId ?? null,
    duplicate: input.duplicate,
    httpStatus: input.httpStatus,
    errorCode: input.errorCode ?? null,
    adapterCorrelation: input.adapterCorrelation,
  });
}

/**
 * POST /api/internal/messaging/inbox/whatsapp
 *
 * Ingest a normalized inbound WhatsApp event from the local bot adapter.
 * Auth: Authorization: Bearer $WHATSAPP_INBOX_WEBHOOK_TOKEN
 */
export async function POST(req: NextRequest) {
  const timer = InboxWebhookPerfTimer.start();

  const auth = requireWhatsAppInboxWebhookAuth(req);
  if (!isWhatsAppInboxWebhookAuthResult(auth)) return auth;

  timer.markAuthCompleted();

  let parsed:
    | ReturnType<typeof parseBody>
    | null = null;

  try {
    const body = (await req.json()) as WhatsAppInboxBody;
    parsed = parseBody(body);
    const adapterCorrelation = extractAdapterCorrelation(parsed.rawPayload);

    const result = await ingestIncomingMessage(parsed, timer);
    const httpStatus = result.duplicate ? 200 : 201;

    logPerf({
      timer,
      provider: parsed.provider,
      providerMessageId: parsed.providerMessageId,
      inboxId: result.inboxId,
      duplicate: result.duplicate,
      httpStatus,
      adapterCorrelation,
    });

    return NextResponse.json(
      {
        ok: true,
        inboxId: result.inboxId,
        duplicate: result.duplicate,
      },
      { status: httpStatus },
    );
  } catch (err: unknown) {
    if (err instanceof MessageInboxError) {
      timer.markValidationCompleted();
      logPerf({
        timer,
        provider: parsed?.provider ?? 'unknown',
        providerMessageId: parsed?.providerMessageId ?? 'unknown',
        duplicate: false,
        httpStatus: 400,
        errorCode: err.code,
        adapterCorrelation: parsed ? extractAdapterCorrelation(parsed.rawPayload) : undefined,
      });
      return NextResponse.json(
        { ok: false, error: err.message, code: err.code },
        { status: 400 },
      );
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/internal/messaging/inbox/whatsapp] error:', message);
    logPerf({
      timer,
      provider: parsed?.provider ?? 'unknown',
      providerMessageId: parsed?.providerMessageId ?? 'unknown',
      duplicate: false,
      httpStatus: 500,
      errorCode: 'INTERNAL_ERROR',
      adapterCorrelation: parsed ? extractAdapterCorrelation(parsed.rawPayload) : undefined,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

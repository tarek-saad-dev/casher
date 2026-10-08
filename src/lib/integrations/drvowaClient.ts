import 'server-only';

export type DrvowaEventMessageInput = {
  eventId: string;
  event: string;
  recipient: string;
  message: string;
  metadata?: Record<string, unknown> | null;
};

export type DrvowaEventMessageResult = {
  ok: boolean;
  eventId: string;
  status: string;
  providerMessageId?: string | null;
  idempotentReplay?: boolean;
};

function integrationConfig(): { baseUrl: string; apiKey: string } {
  const baseUrl = process.env.DRVOWA_BASE_URL?.trim().replace(/\/$/, '');
  const apiKey = process.env.DRVOWA_INBOUND_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    throw new Error('DRVOWA_OUTBOUND_INTEGRATION_NOT_CONFIGURED');
  }
  return { baseUrl, apiKey };
}

/**
 * Generic ERP -> DRVOWA event interface.
 * ERP owns the event trigger, recipient and rendered message.
 * DRVOWA only performs durable/idempotent WhatsApp delivery.
 */
export async function sendDrvowaEventMessage(
  input: DrvowaEventMessageInput,
): Promise<DrvowaEventMessageResult> {
  const { baseUrl, apiKey } = integrationConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`${baseUrl}/api/external/v1/events/message`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
      cache: 'no-store',
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as
      | DrvowaEventMessageResult
      | { error?: string; code?: string }
      | null;

    if (!response.ok) {
      const code =
        payload && 'code' in payload && typeof payload.code === 'string'
          ? payload.code
          : `DRVOWA_HTTP_${response.status}`;
      throw new Error(code);
    }
    return payload as DrvowaEventMessageResult;
  } finally {
    clearTimeout(timer);
  }
}

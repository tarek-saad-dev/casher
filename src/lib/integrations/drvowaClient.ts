import 'server-only';

import { getDrvowaIntegrationConfig } from '@/lib/integrations/drvowaConfig';

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

export async function isDrvowaEventMessagingActive(): Promise<boolean> {
  try {
    const paired = await getDrvowaIntegrationConfig();
    if (paired && paired.status === 'ACTIVE') return true;
    return Boolean(
      process.env.DRVOWA_BASE_URL?.trim()
      && process.env.DRVOWA_INBOUND_API_KEY?.trim(),
    );
  } catch {
    return false;
  }
}

async function integrationConfig(): Promise<{ baseUrl: string; apiKey: string }> {
  const paired = await getDrvowaIntegrationConfig();
  if (paired && paired.status === 'ACTIVE') {
    return {
      baseUrl: paired.drvowaBaseUrl.replace(/\/$/, ''),
      apiKey: paired.inboundApiKey,
    };
  }

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
  const { baseUrl, apiKey } = await integrationConfig();
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


export type DrvowaInboxListItem = {
  conversationId: string;
  phone: string;
  displayName: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: string;
  lastMessageDirection?: 'INBOUND' | 'OUTBOUND' | null;
  needsReply?: boolean;
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
  aiMode: string;
  aiPauseReason: string | null;
  aiReplyHealth?: unknown;
};

export type DrvowaInboxMessage = {
  messageId: string;
  direction: 'inbound' | 'outbound';
  origin: 'CUSTOMER' | 'AI' | 'HUMAN' | 'SYSTEM' | 'UNKNOWN' | string;
  actorName?: string | null;
  actorUserId?: string | null;
  text: string | null;
  occurredAt: string;
  deliveryStatus: string | null;
  createdAtUtc?: string | null;
};

export type DrvowaInboxConversation = DrvowaInboxListItem & {
  pausedAtUtc?: string | null;
  resumedAtUtc?: string | null;
  messages: DrvowaInboxMessage[];
  pageInfo?: {
    hasMore: boolean;
    nextCursor: {
      beforeAt: string | null;
      beforeCreatedAt: string | null;
      beforeMessageId: string;
    } | null;
  };
};

async function drvowaRequest<T>(params: {
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  timeoutMs?: number;
}): Promise<T> {
  const { baseUrl, apiKey } = await integrationConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 10_000);
  try {
    const response = await fetch(`${baseUrl}${params.path}`, {
      method: params.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(params.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: params.body === undefined ? undefined : JSON.stringify(params.body),
      cache: 'no-store',
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as
      | T
      | { error?: string; code?: string }
      | null;
    if (!response.ok) {
      const rec = payload && typeof payload === 'object'
        ? payload as Record<string, unknown>
        : {};
      const code =
        typeof rec.code === 'string'
          ? rec.code
          : typeof rec.error === 'string'
            ? rec.error
            : `DRVOWA_HTTP_${response.status}`;
      throw new Error(code);
    }
    return payload as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function listDrvowaInboxConversations(
  limit = 100,
): Promise<DrvowaInboxListItem[]> {
  const payload = await drvowaRequest<{ items?: DrvowaInboxListItem[] }>({
    path: `/api/external/v1/inbox/conversations?limit=${encodeURIComponent(String(limit))}`,
  });
  return payload.items ?? [];
}

export async function getDrvowaInboxConversation(
  conversationId: string,
  limit = 100,
  before?: {
    beforeAt: string;
    beforeCreatedAt: string;
    beforeMessageId: string;
  } | null,
): Promise<DrvowaInboxConversation | null> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (before) {
    qs.set('beforeAt', before.beforeAt);
    qs.set('beforeCreatedAt', before.beforeCreatedAt);
    qs.set('beforeMessageId', before.beforeMessageId);
  }
  const payload = await drvowaRequest<{ conversation?: DrvowaInboxConversation }>({
    path:
      `/api/external/v1/inbox/conversations/${encodeURIComponent(conversationId)}?${qs.toString()}`,
  });
  return payload.conversation ?? null;
}

export async function sendDrvowaInboxReply(params: {
  conversationId: string;
  text: string;
  idempotencyKey: string;
  actorName?: string | null;
  actorExternalId?: string | null;
}): Promise<Record<string, unknown>> {
  return drvowaRequest<Record<string, unknown>>({
    path:
      `/api/external/v1/inbox/conversations/${encodeURIComponent(params.conversationId)}/messages`,
    method: 'POST',
    body: {
      text: params.text,
      idempotencyKey: params.idempotencyKey,
      actorName: params.actorName ?? undefined,
      actorExternalId: params.actorExternalId ?? undefined,
    },
  });
}

export async function takeoverDrvowaInboxConversation(
  conversationId: string,
): Promise<Record<string, unknown>> {
  return drvowaRequest<Record<string, unknown>>({
    path:
      `/api/external/v1/inbox/conversations/${encodeURIComponent(conversationId)}/takeover`,
    method: 'POST',
  });
}

export async function resumeDrvowaInboxConversation(
  conversationId: string,
): Promise<Record<string, unknown>> {
  return drvowaRequest<Record<string, unknown>>({
    path:
      `/api/external/v1/inbox/conversations/${encodeURIComponent(conversationId)}/resume`,
    method: 'POST',
  });
}

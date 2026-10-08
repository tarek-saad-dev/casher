import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { ActiveTenantMessagingChannel } from '@/modules/messaging/tenancy/channelRepository';

const ingestIncomingMessage = vi.fn();
const listInboxMessages = vi.fn();
const requireSystemJobAuth = vi.fn();
const findActiveChannelByTokenHash = vi.fn();
const activeTenantIds = new Set<string>();

vi.mock('@/modules/messaging/inbox/application/ingestIncomingMessage', () => ({
  ingestIncomingMessage: (...args: unknown[]) => ingestIncomingMessage(...args),
}));

vi.mock('@/modules/messaging/inbox/application/listInboxMessages', () => ({
  listInboxMessages: (...args: unknown[]) => listInboxMessages(...args),
}));

vi.mock('@/lib/api-auth', () => ({
  requireSystemJobAuth: (...args: unknown[]) => requireSystemJobAuth(...args),
  isSystemJobAuthResult: (v: unknown) =>
    typeof v === 'object' && v != null && (v as { ok?: boolean }).ok === true,
  logSecurityEvent: () => {},
}));

vi.mock('@/modules/messaging/tenancy/channelRepository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/messaging/tenancy/channelRepository')>()),
  findActiveChannelByTokenHash: (...args: unknown[]) => findActiveChannelByTokenHash(...args),
}));

vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db')>()),
  getPool: async () => ({
    request() {
      const inputs: Record<string, unknown> = {};
      const req = {
        input(name: string, _type: unknown, value: unknown) {
          inputs[name] = value;
          return req;
        },
        async query() {
          const id = String(inputs.tenantId ?? '').toLowerCase();
          return { recordset: activeTenantIds.has(id) ? [{ ok: 1 }] : [] };
        },
      };
      return req;
    },
  }),
}));

import { POST } from '@/app/api/internal/messaging/inbox/whatsapp/route';
import { GET } from '@/app/api/internal/messaging/inbox/route';
import { MessageInboxError } from '@/modules/messaging/inbox/domain/types';
import { currentMessagingTenantScope } from '@/modules/messaging/tenancy/messagingTenantScope';
import { hashChannelWebhookToken } from '@/modules/messaging/tenancy/channelToken';
import {
  TENANT_A,
  TENANT_B,
  installMessagingTenantTestKit,
  resetMessagingTenantTestKit,
  testChannel,
} from './support/messagingTenantTestKit';

const TOKEN_A = 'channel-token-tenant-a';
const TOKEN_B = 'channel-token-tenant-b';

function channelsByHash(): Record<string, ActiveTenantMessagingChannel> {
  return {
    [hashChannelWebhookToken(TOKEN_A)]: { ...testChannel(TENANT_A), channelId: 'channel-a' },
    [hashChannelWebhookToken(TOKEN_B)]: { ...testChannel(TENANT_B), channelId: 'channel-b' },
  };
}

function whatsappRequest(body: unknown, token: string | null = TOKEN_A): NextRequest {
  return new NextRequest('http://localhost/api/internal/messaging/inbox/whatsapp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token == null ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
}

const VALID_EVENT = {
  provider: 'whatsapp-web',
  providerMessageId: 'phase1-test-001',
  phone: '201234567890',
  messageType: 'text',
  text: 'عايز احجز بكرة',
  receivedAt: '2026-08-28T07:00:00.000Z',
};

let usage: ReturnType<typeof installMessagingTenantTestKit>['usage'];
let ingestScopes: Array<ReturnType<typeof currentMessagingTenantScope>>;

beforeEach(() => {
  ({ usage } = installMessagingTenantTestKit());
  ingestScopes = [];
  findActiveChannelByTokenHash.mockReset();
  const table = channelsByHash();
  findActiveChannelByTokenHash.mockImplementation(async (hash: string) => table[hash] ?? null);
  activeTenantIds.clear();
});

afterEach(() => {
  resetMessagingTenantTestKit();
  vi.unstubAllEnvs();
});

describe('POST /api/internal/messaging/inbox/whatsapp', () => {
  beforeEach(() => {
    ingestIncomingMessage.mockReset();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('WHATSAPP_INBOX_WEBHOOK_TOKEN', '');
  });

  function recordScopeAnd(result: { inboxId: number; duplicate: boolean }) {
    ingestIncomingMessage.mockImplementation(async () => {
      ingestScopes.push(currentMessagingTenantScope());
      return result;
    });
  }

  it('returns 201 on first ingest', async () => {
    recordScopeAnd({ inboxId: 123, duplicate: false });
    const res = await POST(whatsappRequest(VALID_EVENT));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body).toEqual({ ok: true, inboxId: 123, duplicate: false });
    expect(usage).toEqual([{ tenantId: TENANT_A, metric: 'inbound_message', count: 1 }]);
  });

  it('returns 200 on duplicate ingest without metering', async () => {
    recordScopeAnd({ inboxId: 123, duplicate: true });
    const { text: _text, ...event } = VALID_EVENT;
    const res = await POST(whatsappRequest(event));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, inboxId: 123, duplicate: true });
    expect(usage).toEqual([]);
  });

  it('returns 400 for validation errors', async () => {
    ingestIncomingMessage.mockRejectedValue(
      new MessageInboxError('providerMessageId is required', 'MISSING_PROVIDER_MESSAGE_ID'),
    );
    const { providerMessageId: _id, text: _text, ...event } = VALID_EVENT;
    const res = await POST(whatsappRequest(event));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe('MISSING_PROVIDER_MESSAGE_ID');
  });

  it('authenticates by sha256 of the bearer token, never the raw token', async () => {
    recordScopeAnd({ inboxId: 1, duplicate: false });
    await POST(whatsappRequest(VALID_EVENT));
    expect(findActiveChannelByTokenHash).toHaveBeenCalledTimes(1);
    const [hash] = findActiveChannelByTokenHash.mock.calls[0];
    expect(hash).toBe(hashChannelWebhookToken(TOKEN_A));
    expect(hash).not.toBe(TOKEN_A);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('valid channel token ingests within that channel tenant scope', async () => {
    recordScopeAnd({ inboxId: 7, duplicate: false });
    const resA = await POST(whatsappRequest(VALID_EVENT, TOKEN_A));
    const resB = await POST(whatsappRequest({ ...VALID_EVENT, providerMessageId: 'b-1' }, TOKEN_B));
    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    expect(ingestScopes).toHaveLength(2);
    expect(ingestScopes[0]).toMatchObject({ tenantId: TENANT_A, source: 'webhook' });
    expect(ingestScopes[0]?.detail).toContain('channel:channel-a');
    expect(ingestScopes[1]).toMatchObject({ tenantId: TENANT_B, source: 'webhook' });
    expect(ingestScopes[1]?.detail).toContain('channel:channel-b');
    expect(usage).toEqual([
      { tenantId: TENANT_A, metric: 'inbound_message', count: 1 },
      { tenantId: TENANT_B, metric: 'inbound_message', count: 1 },
    ]);
  });

  it('rejects unknown channel token with 401 and does not ingest', async () => {
    const res = await POST(whatsappRequest(VALID_EVENT, 'wrong'));
    expect(res.status).toBe(401);
    expect(ingestIncomingMessage).not.toHaveBeenCalled();
    expect(usage).toEqual([]);
  });

  it('rejects missing bearer token with 401 without channel lookup', async () => {
    const res = await POST(whatsappRequest(VALID_EVENT, null));
    expect(res.status).toBe(401);
    expect(findActiveChannelByTokenHash).not.toHaveBeenCalled();
    expect(ingestIncomingMessage).not.toHaveBeenCalled();
  });

  it('no longer accepts the shared WHATSAPP_INBOX_WEBHOOK_TOKEN', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WHATSAPP_INBOX_WEBHOOK_TOKEN', 'shared-secret');
    const res = await POST(whatsappRequest(VALID_EVENT, 'shared-secret'));
    expect(res.status).toBe(401);
    expect(ingestIncomingMessage).not.toHaveBeenCalled();
  });
});

describe('GET /api/internal/messaging/inbox', () => {
  const CRON_AUTH = {
    ok: true,
    via: 'cron_bearer',
    userId: 0,
    userName: 'system-job',
    userLevel: 'admin',
    roles: ['system_job'],
    isSuperAdmin: true,
    activeBranchId: 0,
    activeBranchCode: 'SYSTEM',
    tenantId: null,
  };

  const ITEMS = [
    {
      id: 1,
      provider: 'whatsapp-web',
      providerMessageId: 'm-1',
      phone: '201234567890',
      chatTitle: 'Ahmed',
      messageType: 'text',
      text: 'hello',
      isGroup: false,
      status: 'pending',
      retryCount: 0,
      receivedAt: '2026-08-28T07:00:00.000Z',
      createdAt: '2026-08-28T07:00:00.000Z',
    },
  ];

  beforeEach(() => {
    listInboxMessages.mockReset();
    requireSystemJobAuth.mockReset();
    requireSystemJobAuth.mockResolvedValue(CRON_AUTH);
    listInboxMessages.mockImplementation(async () => {
      ingestScopes.push(currentMessagingTenantScope());
      return { items: ITEMS, limit: 50 };
    });
    activeTenantIds.add(TENANT_A);
  });

  function inboxRequest(url: string, headers: Record<string, string> = {}): NextRequest {
    return new NextRequest(url, { headers: { Authorization: 'Bearer cron-secret', ...headers } });
  }

  it('lists inbox items for a cron caller naming its tenant via x-tenant-id', async () => {
    const res = await GET(
      inboxRequest('http://localhost/api/internal/messaging/inbox?status=pending&limit=10', {
        'x-tenant-id': TENANT_A,
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).not.toHaveProperty('rawPayload');
    expect(listInboxMessages).toHaveBeenCalledWith({ status: 'pending', limit: 10 });
    expect(ingestScopes[0]).toMatchObject({ tenantId: TENANT_A, source: 'system-job' });
  });

  it('accepts ?tenantId= for cron callers', async () => {
    const res = await GET(
      inboxRequest(`http://localhost/api/internal/messaging/inbox?tenantId=${TENANT_A}`),
    );
    expect(res.status).toBe(200);
    expect(ingestScopes[0]).toMatchObject({ tenantId: TENANT_A, source: 'system-job' });
  });

  it('cron caller without tenant gets 400 TENANT_REQUIRED', async () => {
    const res = await GET(inboxRequest('http://localhost/api/internal/messaging/inbox'));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe('TENANT_REQUIRED');
    expect(listInboxMessages).not.toHaveBeenCalled();
  });

  it('cron caller with malformed tenant gets 400 TENANT_REQUIRED', async () => {
    const res = await GET(
      inboxRequest('http://localhost/api/internal/messaging/inbox', { 'x-tenant-id': 'not-a-uuid' }),
    );
    expect(res.status).toBe(400);
    expect(listInboxMessages).not.toHaveBeenCalled();
  });

  it('cron caller naming an inactive/unknown tenant gets 404', async () => {
    const res = await GET(
      inboxRequest('http://localhost/api/internal/messaging/inbox', { 'x-tenant-id': TENANT_B }),
    );
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.code).toBe('TENANT_NOT_FOUND');
    expect(listInboxMessages).not.toHaveBeenCalled();
  });

  it('session caller acts in its own tenant and cannot override it via header', async () => {
    requireSystemJobAuth.mockResolvedValue({ ...CRON_AUTH, via: 'session', tenantId: TENANT_B });
    const res = await GET(
      inboxRequest('http://localhost/api/internal/messaging/inbox', { 'x-tenant-id': TENANT_A }),
    );
    expect(res.status).toBe(200);
    expect(ingestScopes[0]).toMatchObject({ tenantId: TENANT_B, source: 'staff' });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const ingestIncomingMessage = vi.fn();
const listInboxMessages = vi.fn();
const requireSystemJobAuth = vi.fn();

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
}));

import { POST } from '@/app/api/internal/messaging/inbox/whatsapp/route';
import { GET } from '@/app/api/internal/messaging/inbox/route';
import { MessageInboxError } from '@/modules/messaging/inbox/domain/types';

function whatsappRequest(body: unknown, token = 'dev'): NextRequest {
  return new NextRequest('http://localhost/api/internal/messaging/inbox/whatsapp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/internal/messaging/inbox/whatsapp', () => {
  beforeEach(() => {
    ingestIncomingMessage.mockReset();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('WHATSAPP_INBOX_WEBHOOK_TOKEN', '');
  });

  it('returns 201 on first ingest', async () => {
    ingestIncomingMessage.mockResolvedValue({ inboxId: 123, duplicate: false });
    const res = await POST(
      whatsappRequest({
        provider: 'whatsapp-web',
        providerMessageId: 'phase1-test-001',
        phone: '201234567890',
        messageType: 'text',
        text: 'عايز احجز بكرة',
        receivedAt: '2026-08-28T07:00:00.000Z',
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body).toEqual({ ok: true, inboxId: 123, duplicate: false });
  });

  it('returns 200 on duplicate ingest', async () => {
    ingestIncomingMessage.mockResolvedValue({ inboxId: 123, duplicate: true });
    const res = await POST(
      whatsappRequest({
        provider: 'whatsapp-web',
        providerMessageId: 'phase1-test-001',
        phone: '201234567890',
        messageType: 'text',
        receivedAt: '2026-08-28T07:00:00.000Z',
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, inboxId: 123, duplicate: true });
  });

  it('returns 400 for validation errors', async () => {
    ingestIncomingMessage.mockRejectedValue(
      new MessageInboxError('providerMessageId is required', 'MISSING_PROVIDER_MESSAGE_ID'),
    );
    const res = await POST(
      whatsappRequest({
        provider: 'whatsapp-web',
        phone: '201234567890',
        messageType: 'text',
        receivedAt: '2026-08-28T07:00:00.000Z',
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe('MISSING_PROVIDER_MESSAGE_ID');
  });

  it('rejects missing bearer token in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WHATSAPP_INBOX_WEBHOOK_TOKEN', 'secret-token');
    const res = await POST(
      whatsappRequest(
        {
          provider: 'whatsapp-web',
          providerMessageId: 'x',
          phone: '201234567890',
          messageType: 'text',
          receivedAt: '2026-08-28T07:00:00.000Z',
        },
        'wrong',
      ),
    );
    expect(res.status).toBe(401);
  });
});

describe('GET /api/internal/messaging/inbox', () => {
  beforeEach(() => {
    listInboxMessages.mockReset();
    requireSystemJobAuth.mockReset();
    requireSystemJobAuth.mockResolvedValue({
      ok: true,
      via: 'cron_bearer',
      userId: 0,
      userName: 'system-job',
      userLevel: 'admin',
      roles: ['system_job'],
      isSuperAdmin: true,
      activeBranchId: 0,
      activeBranchCode: 'SYSTEM',
    });
  });

  it('lists inbox items for authorized callers', async () => {
    listInboxMessages.mockResolvedValue({
      items: [
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
      ],
      limit: 50,
    });

    const req = new NextRequest(
      'http://localhost/api/internal/messaging/inbox?status=pending&limit=10',
      {
        headers: { Authorization: 'Bearer cron-secret' },
      },
    );
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).not.toHaveProperty('rawPayload');
    expect(listInboxMessages).toHaveBeenCalledWith({ status: 'pending', limit: 10 });
  });
});

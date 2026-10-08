import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

const authenticate = vi.fn();
const sendWhatsAppMessage = vi.fn();
const sendQuickWhatsAppMessage = vi.fn();
const getWhatsAppConfig = vi.fn();

vi.mock('@/lib/api-auth', () => ({
  authenticate: (...args: unknown[]) => authenticate(...args),
  isAuthResult: (v: unknown) => !(v instanceof NextResponse) && (v as { ok?: boolean }).ok === true,
}));

vi.mock('@/lib/integrations/whatsapp', () => ({
  sendWhatsAppMessage: (...args: unknown[]) => sendWhatsAppMessage(...args),
  sendQuickWhatsAppMessage: (...args: unknown[]) => sendQuickWhatsAppMessage(...args),
  getWhatsAppConfig: (...args: unknown[]) => getWhatsAppConfig(...args),
  sendWhatsAppGroupMessage: vi.fn(),
  checkWhatsAppStatus: vi.fn(),
  checkWhatsAppBotHealth: vi.fn(),
}));

import { POST } from '@/app/api/pos/whatsapp/quick-send/route';
import {
  DEFAULT_TEST_ENDPOINT,
  TENANT_A,
  TENANT_B,
  installMessagingTenantTestKit,
  resetMessagingTenantTestKit,
} from './support/messagingTenantTestKit';

const ROUTE_FILE = path.join(
  process.cwd(),
  'src/app/api/pos/whatsapp/quick-send/route.ts',
);

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/pos/whatsapp/quick-send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function staffAuth(tenantId: string = TENANT_A) {
  return {
    ok: true,
    userId: 12,
    userName: 'cashier',
    userLevel: 'user',
    roles: [],
    isSuperAdmin: false,
    activeBranchId: 3,
    activeBranchCode: 'GLEEM',
    tenantId,
    membershipId: 'membership-1',
  };
}

let usage: ReturnType<typeof installMessagingTenantTestKit>['usage'];

describe('POST /api/pos/whatsapp/quick-send', () => {
  beforeEach(() => {
    ({ usage } = installMessagingTenantTestKit({
      channels: {
        [TENANT_A]: { endpointUrl: DEFAULT_TEST_ENDPOINT },
        [TENANT_B]: { endpointUrl: 'http://bridge-b.test' },
      },
    }));
    authenticate.mockReset();
    sendWhatsAppMessage.mockReset();
    sendQuickWhatsAppMessage.mockReset();
    getWhatsAppConfig.mockReset();
    getWhatsAppConfig.mockReturnValue({
      defaultQuickMessage: 'أهلا بك في Cut Salon',
      quickMessageEnabled: true,
    });
    authenticate.mockResolvedValue(staffAuth());
  });

  afterEach(() => {
    resetMessagingTenantTestKit();
  });

  it('is wired through the Messaging Module, not the legacy typed sender', () => {
    const src = readFileSync(ROUTE_FILE, 'utf8');
    expect(src).toContain("@/modules/messaging");
    expect(src).toContain('sendMessage');
    expect(src).not.toContain('sendQuickWhatsAppMessage');
  });

  it('authenticates with tenant identity and runs in staff messaging scope', () => {
    const src = readFileSync(ROUTE_FILE, 'utf8');
    expect(src).toContain('authenticate()');
    expect(src).toContain('runWithStaffMessagingTenant');
    expect(src).not.toContain('getSession');
  });

  it('sends generic Gateway payload without type through the tenant channel', async () => {
    sendWhatsAppMessage.mockResolvedValue({
      sent: true,
      skipped: false,
      status: 'sent',
      messageId: 'wa-quick-1',
    });

    const res = await POST(
      makeRequest({
        phone: '01557994946',
        customerName: 'طارق',
        message: 'أهلا بك في Cut Salon',
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      result: {
        sent: true,
        skipped: false,
        status: 'sent',
        messageId: 'wa-quick-1',
      },
    });
    expect(sendQuickWhatsAppMessage).not.toHaveBeenCalled();
    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      {
        phone: '01557994946',
        message: 'أهلا بك في Cut Salon',
        metadata: {
          source: 'pos.quick_message',
          branchId: 3,
          userId: 12,
        },
      },
      { apiBaseUrl: DEFAULT_TEST_ENDPOINT },
    );
    const gatewayBody = sendWhatsAppMessage.mock.calls[0][0] as Record<string, unknown>;
    expect(gatewayBody).not.toHaveProperty('type');
    expect(Object.keys(gatewayBody).sort()).toEqual(['message', 'metadata', 'phone']);
    expect(usage).toEqual([{ tenantId: TENANT_A, metric: 'outbound_sent', count: 1 }]);
  });

  it("sends through the signed-in tenant's own channel only", async () => {
    authenticate.mockResolvedValue(staffAuth(TENANT_B));
    sendWhatsAppMessage.mockResolvedValue({ sent: true, skipped: false, status: 'sent', messageId: 'b-1' });

    const res = await POST(makeRequest({ phone: '01557994946', message: 'hi' }));
    expect(res.status).toBe(200);
    expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppMessage.mock.calls[0][1]).toEqual({ apiBaseUrl: 'http://bridge-b.test' });
    expect(usage).toEqual([{ tenantId: TENANT_B, metric: 'outbound_sent', count: 1 }]);
  });

  it('tenant without a channel is skipped with channel_not_configured (no fallback bridge)', async () => {
    resetMessagingTenantTestKit();
    installMessagingTenantTestKit({ channels: { [TENANT_A]: { endpointUrl: DEFAULT_TEST_ENDPOINT } } });
    authenticate.mockResolvedValue(staffAuth(TENANT_B));

    const res = await POST(makeRequest({ phone: '01557994946', message: 'hi' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: 'لم يتم ربط قناة واتساب لهذا النشاط بعد',
      result: { sent: false, skipped: true, reason: 'channel_not_configured' },
    });
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it('keeps the current unauthenticated and validation response contract', async () => {
    authenticate.mockResolvedValue(NextResponse.json({ error: 'غير مصرح' }, { status: 401 }));
    let res = await POST(makeRequest({ phone: '01557994946', message: 'hi' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'غير مصرح' });

    authenticate.mockResolvedValue(staffAuth());

    res = await POST(makeRequest({ phone: '12', message: 'hi' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'أدخل رقم واتساب صحيح' });

    res = await POST(makeRequest({ phone: '01557994946', message: '   ' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'الرسالة فارغة' });

    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it('keeps skipped/failure HTTP contract', async () => {
    sendWhatsAppMessage.mockResolvedValue({
      sent: false,
      skipped: true,
      reason: 'development_only',
    });
    let res = await POST(
      makeRequest({ phone: '01557994946', message: 'أهلا بك في Cut Salon' }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: 'تكامل واتساب غير مفعّل حالياً',
      result: { sent: false, skipped: true, reason: 'development_only' },
    });

    sendWhatsAppMessage.mockResolvedValue({
      sent: false,
      skipped: false,
      reason: 'timeout',
    });
    res = await POST(
      makeRequest({ phone: '01557994946', message: 'أهلا بك في Cut Salon' }),
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      ok: false,
      error: 'انتهت مهلة الاتصال بسكربت الواتساب',
      result: { sent: false, skipped: false, reason: 'timeout' },
    });
    expect(usage).toEqual([{ tenantId: TENANT_A, metric: 'outbound_failed', count: 1 }]);
  });
});

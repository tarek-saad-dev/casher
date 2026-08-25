import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';

const getSession = vi.fn();
const sendWhatsAppMessage = vi.fn();
const sendQuickWhatsAppMessage = vi.fn();
const getWhatsAppConfig = vi.fn();

vi.mock('@/lib/session', () => ({
  getSession: (...args: unknown[]) => getSession(...args),
}));

vi.mock('@/lib/integrations/whatsapp', () => ({
  sendWhatsAppMessage: (...args: unknown[]) => sendWhatsAppMessage(...args),
  sendQuickWhatsAppMessage: (...args: unknown[]) => sendQuickWhatsAppMessage(...args),
  getWhatsAppConfig: (...args: unknown[]) => getWhatsAppConfig(...args),
}));

import { POST } from '@/app/api/pos/whatsapp/quick-send/route';

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

describe('POST /api/pos/whatsapp/quick-send', () => {
  beforeEach(() => {
    getSession.mockReset();
    sendWhatsAppMessage.mockReset();
    sendQuickWhatsAppMessage.mockReset();
    getWhatsAppConfig.mockReset();
    getWhatsAppConfig.mockReturnValue({
      defaultQuickMessage: 'أهلا بك في Cut Salon',
      quickMessageEnabled: true,
    });
    getSession.mockResolvedValue({
      UserID: 12,
      UserName: 'cashier',
      UserLevel: 'user',
      ActiveBranchID: 3,
      ActiveBranchCode: 'GLEEM',
      BranchSessionVersion: 1,
    });
  });

  it('is wired through the Messaging Module, not the legacy typed sender', () => {
    const src = readFileSync(ROUTE_FILE, 'utf8');
    expect(src).toContain("@/modules/messaging");
    expect(src).toContain('sendMessage');
    expect(src).not.toContain('sendQuickWhatsAppMessage');
  });

  it('sends generic Gateway payload without type', async () => {
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
    expect(sendWhatsAppMessage).toHaveBeenCalledWith({
      phone: '01557994946',
      message: 'أهلا بك في Cut Salon',
      metadata: {
        source: 'pos.quick_message',
        branchId: 3,
        userId: 12,
      },
    });
    const gatewayBody = sendWhatsAppMessage.mock.calls[0][0] as Record<string, unknown>;
    expect(gatewayBody).not.toHaveProperty('type');
    expect(Object.keys(gatewayBody).sort()).toEqual(['message', 'metadata', 'phone']);
  });

  it('keeps the current unauthenticated and validation response contract', async () => {
    getSession.mockResolvedValue(null);
    let res = await POST(makeRequest({ phone: '01557994946', message: 'hi' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'غير مصرح' });

    getSession.mockResolvedValue({
      UserID: 12,
      UserName: 'cashier',
      UserLevel: 'user',
      ActiveBranchID: 3,
      ActiveBranchCode: 'GLEEM',
      BranchSessionVersion: 1,
    });

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
  });
});

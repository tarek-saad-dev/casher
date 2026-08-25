/**
 * WhatsApp Integration — Unit Tests (Phase 8 Generic Gateway)
 *
 * All HTTP requests are mocked — no real WhatsApp messages are sent.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let mockFetchResponse: {
  ok: boolean;
  status: number;
  text: string;
} = { ok: true, status: 200, text: '{}' };

let lastFetchUrl = '';
let lastFetchBody: unknown = null;

vi.stubGlobal('fetch', async (url: string, opts?: { body?: string }) => {
  lastFetchUrl = String(url);
  lastFetchBody = opts?.body ? JSON.parse(opts.body) : null;
  return {
    ok: mockFetchResponse.ok,
    status: mockFetchResponse.status,
    text: async () => mockFetchResponse.text,
  };
});

function setEnv(enabled = true) {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('WHATSAPP_INTEGRATION_ENABLED', enabled ? 'true' : 'false');
  vi.stubEnv('WHATSAPP_API_BASE_URL', 'http://127.0.0.1:3001');
  vi.stubEnv('WHATSAPP_REQUEST_TIMEOUT_MS', '5000');
}

function setFetchResponse(status: number, body: Record<string, unknown>) {
  mockFetchResponse = {
    ok: status >= 200 && status < 300,
    status,
    text: JSON.stringify(body),
  };
}

import {
  sendWhatsAppMessage,
  checkWhatsAppStatus,
  checkWhatsAppBotHealth,
} from '../service';
import { getConfig } from '../config';
import { resolvePhone } from '../payload-builders';

beforeEach(() => {
  setEnv(true);
  lastFetchUrl = '';
  lastFetchBody = null;
  setFetchResponse(200, {
    success: true,
    ok: true,
    status: 'sent',
    messageId: 'wa-generic-1',
    type: 'generic',
    sentAt: '2026-08-25T01:00:00.000Z',
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Generic Gateway send', () => {
  it('POSTs phone/message/metadata without type', async () => {
    const result = await sendWhatsAppMessage({
      phone: '01557994946',
      message: 'أهلا بك في Cut Salon',
      metadata: { source: 'test' },
    });

    expect(result.sent).toBe(true);
    if (result.sent) expect(result.messageId).toBe('wa-generic-1');
    expect(lastFetchUrl).toBe('http://127.0.0.1:3001/api/whatsapp/send');
    expect(lastFetchBody).toEqual({
      phone: '01557994946',
      message: 'أهلا بك في Cut Salon',
      metadata: { source: 'test' },
    });
    expect(lastFetchBody).not.toHaveProperty('type');
  });

  it('forwards optional idempotencyKey', async () => {
    await sendWhatsAppMessage({
      phone: '01557994946',
      message: 'hello',
      idempotencyKey: 'campaign:1:recipient:9',
    });
    expect(lastFetchBody).toMatchObject({
      phone: '01557994946',
      message: 'hello',
      idempotencyKey: 'campaign:1:recipient:9',
    });
    expect(lastFetchBody).not.toHaveProperty('type');
  });

  it('skips when integration disabled', async () => {
    setEnv(false);
    const result = await sendWhatsAppMessage({
      phone: '01557994946',
      message: 'hello',
    });
    expect(result).toMatchObject({
      sent: false,
      skipped: true,
      reason: 'development_only',
    });
    expect(lastFetchUrl).toBe('');
  });

  it('skips empty phone/message', async () => {
    const missingPhone = await sendWhatsAppMessage({ phone: '  ', message: 'x' });
    expect(missingPhone).toMatchObject({ sent: false, reason: 'missing_phone' });

    const emptyMsg = await sendWhatsAppMessage({ phone: '01557994946', message: '' });
    expect(emptyMsg).toMatchObject({ sent: false, reason: 'invalid_payload' });
    expect(lastFetchUrl).toBe('');
  });

  it('maps gateway failure without treating as sent', async () => {
    setFetchResponse(503, { success: false, error: 'not ready', reason: 'whatsapp_not_ready' });
    const result = await sendWhatsAppMessage({
      phone: '01557994946',
      message: 'hello',
    });
    expect(result.sent).toBe(false);
  });
});

describe('status and health', () => {
  it('GET /api/whatsapp/status', async () => {
    // status client checks /api/health first, then /api/whatsapp/status
    let call = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      lastFetchUrl = String(url);
      call += 1;
      if (String(url).endsWith('/api/health')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ status: 'ok' }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            success: true,
            chromeConnected: true,
            whatsappReady: true,
            whatsappTabFound: true,
          }),
      };
    });

    const status = await checkWhatsAppStatus();
    expect(status.available).toBe(true);
    expect(lastFetchUrl).toBe('http://127.0.0.1:3001/api/whatsapp/status');
    expect(call).toBeGreaterThanOrEqual(2);
  });

  it('GET /api/health', async () => {
    setFetchResponse(200, { status: 'ok' });
    const health = await checkWhatsAppBotHealth();
    expect(health.ok).toBe(true);
    expect(lastFetchUrl).toBe('http://127.0.0.1:3001/api/health');
  });

  it('reads config without exposing secrets', () => {
    const cfg = getConfig();
    expect(cfg.apiBaseUrl).toBe('http://127.0.0.1:3001');
    expect(cfg.enabled).toBe(true);
  });
});

describe('helpers', () => {
  it('resolvePhone prefers first non-empty', () => {
    expect(resolvePhone('0155', null)).toBe('0155');
    expect(resolvePhone(null, '0100')).toBe('0100');
    expect(resolvePhone(null, null)).toBeNull();
  });
});

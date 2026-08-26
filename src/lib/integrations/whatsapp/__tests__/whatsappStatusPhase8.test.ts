/**
 * WhatsApp status/health — Phase 8 Pure Gateway contract tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

let lastFetchUrl = '';
type FetchHandler = (url: string) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}>;

let fetchHandler: FetchHandler;

vi.stubGlobal('fetch', async (url: string) => {
  lastFetchUrl = String(url);
  return fetchHandler(String(url));
});

function jsonResponse(status: number, body: unknown) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => body,
  };
}

function setEnv(enabled = true) {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('WHATSAPP_INTEGRATION_ENABLED', enabled ? 'true' : 'false');
  vi.stubEnv('WHATSAPP_API_BASE_URL', 'http://127.0.0.1:3001');
  vi.stubEnv('WHATSAPP_REQUEST_TIMEOUT_MS', '5000');
}

const PHASE8_READY_STATUS = {
  success: true,
  chromeConnected: true,
  whatsappReady: true,
  debugPort: 9222,
  profileDirectory: 'C:\\BotProfile',
  profileName: 'BotProfile',
  whatsappTabFound: true,
};

import {
  checkWhatsAppStatus,
  checkWhatsAppBotHealth,
} from '../service';

beforeEach(() => {
  setEnv(true);
  lastFetchUrl = '';
  fetchHandler = async () => jsonResponse(500, { error: 'unhandled' });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Phase 8 health contract', () => {
  it('treats health {status:"ok"} as healthy', async () => {
    fetchHandler = async () => jsonResponse(200, { status: 'ok', timestamp: '2026-08-26T00:00:00.000Z' });
    const health = await checkWhatsAppBotHealth();
    expect(health).toEqual({ ok: true, httpStatus: 200 });
    expect(lastFetchUrl).toBe('http://127.0.0.1:3001/api/health');
  });

  it('rejects HTTP 200 without status:"ok"', async () => {
    fetchHandler = async () => jsonResponse(200, { ok: true });
    const health = await checkWhatsAppBotHealth();
    expect(health.ok).toBe(false);
    if (!health.ok) expect(health.reason).toBe('invalid_response');
  });

  it('marks network failure as connection_failed', async () => {
    fetchHandler = async () => {
      throw new Error('ECONNREFUSED');
    };
    const health = await checkWhatsAppBotHealth();
    expect(health).toEqual({ ok: false, reason: 'connection_failed' });
  });
});

describe('Phase 8 status contract', () => {
  function mockHealthAndStatus(statusBody: unknown, healthBody: unknown = { status: 'ok' }) {
    fetchHandler = async (url) => {
      if (url.endsWith('/api/health')) return jsonResponse(200, healthBody);
      if (url.endsWith('/api/whatsapp/status')) return jsonResponse(200, statusBody);
      return jsonResponse(404, { error: 'missing' });
    };
  }

  it('maps production Phase 8 payload as connected', async () => {
    mockHealthAndStatus(PHASE8_READY_STATUS);
    const status = await checkWhatsAppStatus();
    expect(status).toEqual({
      available: true,
      chromeConnected: true,
      whatsappReady: true,
      whatsappTabFound: true,
      connected: true,
    });
  });

  it('maps whatsappTabFound=true correctly when other flags ready', async () => {
    mockHealthAndStatus({
      success: true,
      chromeConnected: true,
      whatsappReady: true,
      whatsappTabFound: true,
    });
    const status = await checkWhatsAppStatus();
    expect(status.available).toBe(true);
    if (status.available) {
      expect(status.whatsappTabFound).toBe(true);
      expect(status.connected).toBe(true);
    }
  });

  it('health OK + WhatsApp not ready is degraded (available), not unavailable', async () => {
    mockHealthAndStatus({
      success: true,
      chromeConnected: true,
      whatsappReady: false,
      whatsappTabFound: false,
    });
    const status = await checkWhatsAppStatus();
    expect(status.available).toBe(true);
    if (status.available) {
      expect(status.connected).toBe(false);
      expect(status.whatsappReady).toBe(false);
      expect(status.chromeConnected).toBe(true);
      expect(status.whatsappTabFound).toBe(false);
    }
  });

  it('network failure alone gives unavailable', async () => {
    fetchHandler = async () => {
      throw new Error('fetch failed');
    };
    const status = await checkWhatsAppStatus();
    expect(status).toEqual({ available: false, reason: 'connection_failed' });
  });
});

describe('admin status route auth', () => {
  it('uses requireWhatsAppTemplateAdmin, not requireDevelopmentAdmin', () => {
    const src = readFileSync(
      path.join(process.cwd(), 'src/app/api/admin/whatsapp/status/route.ts'),
      'utf8',
    );
    expect(src).toContain('requireWhatsAppTemplateAdmin');
    expect(src).not.toContain('requireDevelopmentAdmin');
  });
});

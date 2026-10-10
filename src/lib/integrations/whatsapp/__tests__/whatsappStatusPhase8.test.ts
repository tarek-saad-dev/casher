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
import { tenantChannelHealth, tenantChannelStatus } from '@/modules/messaging/tenancy/transport';
import { TenantContextError } from '@/platform/tenant/tenantContext';
import {
  TENANT_A,
  TENANT_B,
  inTenant,
  installMessagingTenantTestKit,
  resetMessagingTenantTestKit,
} from '@/modules/messaging/__tests__/support/messagingTenantTestKit';

const ENDPOINT = { apiBaseUrl: 'http://bridge-a.test' };

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
    const health = await checkWhatsAppBotHealth(ENDPOINT);
    expect(health).toEqual({ ok: true, httpStatus: 200 });
    expect(lastFetchUrl).toBe('http://bridge-a.test/api/health');
  });

  it('rejects HTTP 200 without status:"ok"', async () => {
    fetchHandler = async () => jsonResponse(200, { ok: true });
    const health = await checkWhatsAppBotHealth(ENDPOINT);
    expect(health.ok).toBe(false);
    if (!health.ok) expect(health.reason).toBe('invalid_response');
  });

  it('marks network failure as connection_failed', async () => {
    fetchHandler = async () => {
      throw new Error('ECONNREFUSED');
    };
    const health = await checkWhatsAppBotHealth(ENDPOINT);
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
    const status = await checkWhatsAppStatus(ENDPOINT);
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
    const status = await checkWhatsAppStatus(ENDPOINT);
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
    const status = await checkWhatsAppStatus(ENDPOINT);
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
    const status = await checkWhatsAppStatus(ENDPOINT);
    expect(status).toEqual({ available: false, reason: 'connection_failed' });
  });
});

describe('tenant channel status/health', () => {
  beforeEach(() => {
    installMessagingTenantTestKit({
      channels: { [TENANT_A]: { endpointUrl: 'http://bridge-a.test' }, [TENANT_B]: null },
    });
  });
  afterEach(() => {
    resetMessagingTenantTestKit();
  });

  it('probes only the scoped tenant channel endpoint', async () => {
    const urls: string[] = [];
    fetchHandler = async (url) => {
      urls.push(url);
      if (url.endsWith('/api/health')) return jsonResponse(200, { status: 'ok' });
      return jsonResponse(200, PHASE8_READY_STATUS);
    };
    const status = await inTenant(TENANT_A, () => tenantChannelStatus());
    const health = await inTenant(TENANT_A, () => tenantChannelHealth());
    expect(status.available).toBe(true);
    expect(health).toEqual({ ok: true, httpStatus: 200 });
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => u.startsWith('http://bridge-a.test/'))).toBe(true);
  });

  it('tenant without a channel is channel_not_configured and never fetches', async () => {
    fetchHandler = async (url) => {
      throw new Error(`unexpected fetch ${url}`);
    };
    expect(await inTenant(TENANT_B, () => tenantChannelStatus())).toEqual({
      available: false,
      reason: 'channel_not_configured',
    });
    expect(await inTenant(TENANT_B, () => tenantChannelHealth())).toEqual({
      ok: false,
      reason: 'channel_not_configured',
    });
    expect(lastFetchUrl).toBe('');
  });

  it('requires an ambient tenant scope', async () => {
    await expect(tenantChannelStatus()).rejects.toBeInstanceOf(TenantContextError);
    await expect(tenantChannelHealth()).rejects.toBeInstanceOf(TenantContextError);
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

  it('probes the signed-in tenant channel inside staff scope, not the env bridge URL', () => {
    const src = readFileSync(
      path.join(process.cwd(), 'src/app/api/admin/whatsapp/status/route.ts'),
      'utf8',
    );
    expect(src).toContain('runWithStaffMessagingTenant');
    expect(src).toContain('resolveCurrentTenantChannel');
    expect(src).toContain('tenantChannelStatus');
    expect(src).toContain('tenantChannelHealth');
    expect(src).not.toContain('cfg.apiBaseUrl');
  });
});

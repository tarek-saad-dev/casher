import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getLoopbackPermissionState, getLocalAgentHealth, checkLocalPrintServiceHealth,
  REQUIRED_AGENT_VERSION, fetchLocalPrintAgent,
} from '../localPrintClient';

afterEach(() => vi.unstubAllGlobals());

describe('CUT local print Chrome Loopback V2', () => {
  it('queries granular loopback permission, never the deprecated combined name', async () => {
    const query = vi.fn(async ({ name }: { name: string }) => {
      expect(name).toBe('loopback-network');
      return { state: 'denied' };
    });
    vi.stubGlobal('navigator', { permissions: { query } });
    expect(await getLoopbackPermissionState()).toBe('denied');
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('handles browsers without the granular permissions API safely', async () => {
    vi.stubGlobal('navigator', { permissions: { query: async () => { throw new TypeError('unknown permission'); } } });
    expect(await getLoopbackPermissionState()).toBe('unsupported');
  });
  it('declares loopback address space for fetch', async () => {
    const mock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await fetchLocalPrintAgent('http://127.0.0.1:7788/health', {}, mock);
    expect(mock).toHaveBeenCalledWith('http://127.0.0.1:7788/health', expect.objectContaining({
      mode: 'cors', targetAddressSpace: 'loopback',
    }));
  });
  it('reports agent version and unavailable connections without claiming CORS is confirmed', async () => {
    const healthy = vi.fn(async () => new Response(JSON.stringify({ ok: true, version: '2.0.0' }), { status: 200 }));
    expect((await getLocalAgentHealth(1000, healthy)).version).toBe(REQUIRED_AGENT_VERSION);
    expect(await checkLocalPrintServiceHealth(1000, healthy)).toBe(true);
    const unreachable = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    expect(await checkLocalPrintServiceHealth(1000, unreachable)).toBe(false);
  });
});

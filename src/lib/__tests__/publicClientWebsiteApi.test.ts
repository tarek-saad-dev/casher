import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  classifyProxyAuth,
  isAnonymousPublicPath,
} from '@/lib/proxyPublicRoutes';
import {
  getClientMobileLookupSuffix,
  normalizeClientWebsiteMobileInput,
  pickEditableClientUpdateFields,
} from '@/lib/client/publicClientWebsite.helpers';

vi.mock('server-only', () => ({}));

const lookupClientByMobile = vi.fn();
const updateClientWebsiteProfile = vi.fn();

vi.mock('@/lib/client/publicClientWebsite.service', () => ({
  lookupClientByMobile: (...args: unknown[]) => lookupClientByMobile(...args),
  updateClientWebsiteProfile: (...args: unknown[]) => updateClientWebsiteProfile(...args),
}));

vi.mock('@/lib/client/publicClientWebsiteRateLimit', () => ({
  isPublicClientWebsiteLookupRateLimited: vi.fn(() => false),
  isPublicClientWebsiteUpdateRateLimited: vi.fn(() => false),
}));

describe('public client website proxy allowlist', () => {
  it('allows lookup and update without staff session', () => {
    expect(isAnonymousPublicPath('/api/client/lookup')).toBe(true);
    expect(isAnonymousPublicPath('/api/client/update')).toBe(true);
    expect(classifyProxyAuth('/api/client/lookup').kind).toBe('anonymous_public');
    expect(classifyProxyAuth('/api/client/update').kind).toBe('anonymous_public');
  });

  it('does not expose other /api/client/* routes', () => {
    expect(isAnonymousPublicPath('/api/client/admin')).toBe(false);
    expect(isAnonymousPublicPath('/api/client/lookup/extra')).toBe(false);
    expect(classifyProxyAuth('/api/client/secret').kind).toBe('session_required');
  });

  it('keeps loyalty redeem public under /api/public/', () => {
    expect(isAnonymousPublicPath('/api/public/client/loyalty/rewards/1/redeem')).toBe(true);
  });
});

describe('client mobile lookup suffix', () => {
  it('normalizes Egyptian numbers and matches last 10 digits', () => {
    expect(normalizeClientWebsiteMobileInput('+20 101 234 5678')).toBe('01012345678');
    expect(getClientMobileLookupSuffix('+20 101 234 5678')).toBe('1012345678');
    expect(getClientMobileLookupSuffix('00201012345678')).toBe('1012345678');
  });

  it('returns null when fewer than 10 digits', () => {
    expect(getClientMobileLookupSuffix('12345')).toBeNull();
  });
});

describe('pickEditableClientUpdateFields', () => {
  it('ignores unknown fields safely', () => {
    const { fields, hasEditableField } = pickEditableClientUpdateFields({
      name: 'Ali',
      isAdmin: true,
      ClientID: 999,
    });
    expect(hasEditableField).toBe(true);
    expect(fields).toEqual({ name: 'Ali' });
    expect((fields as Record<string, unknown>).isAdmin).toBeUndefined();
  });
});

describe('GET /api/client/lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  async function loadLookup() {
    const mod = await import('@/app/api/client/lookup/route');
    return mod.GET;
  }

  it('returns 400 when mobile is missing', async () => {
    const GET = await loadLookup();
    const res = await GET(new NextRequest('http://localhost/api/client/lookup'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      message: 'mobile parameter is required',
    });
  });

  it('returns found contract', async () => {
    lookupClientByMobile.mockResolvedValueOnce({
      id: 123,
      name: 'Test User',
      mobile: '01012345678',
      phone: '0221234567',
      address: 'Cairo',
      email: 'test@example.com',
    });
    const GET = await loadLookup();
    const res = await GET(
      new NextRequest('http://localhost/api/client/lookup?mobile=01012345678'),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      found: true,
      client: {
        id: 123,
        name: 'Test User',
        mobile: '01012345678',
        phone: '0221234567',
        address: 'Cairo',
        email: 'test@example.com',
      },
    });
  });

  it('returns not-found contract', async () => {
    lookupClientByMobile.mockResolvedValueOnce(null);
    const GET = await loadLookup();
    const res = await GET(
      new NextRequest('http://localhost/api/client/lookup?mobile=01099999999'),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      found: false,
      client: null,
    });
  });

  it('returns 500 on database error', async () => {
    lookupClientByMobile.mockRejectedValueOnce(new Error('db down'));
    const GET = await loadLookup();
    const res = await GET(
      new NextRequest('http://localhost/api/client/lookup?mobile=01012345678'),
    );
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      message: 'Database error',
    });
  });
});

describe('PATCH /api/client/update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  async function loadUpdate() {
    const mod = await import('@/app/api/client/update/route');
    return mod.PATCH;
  }

  it('returns 400 when clientId is missing', async () => {
    const PATCH = await loadUpdate();
    const res = await PATCH(
      new NextRequest('http://localhost/api/client/update', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Ali' }),
      }),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      message: 'clientId is required',
    });
  });

  it('returns 400 when no update fields are provided', async () => {
    const PATCH = await loadUpdate();
    const res = await PATCH(
      new NextRequest('http://localhost/api/client/update', {
        method: 'PATCH',
        body: JSON.stringify({ clientId: 123 }),
      }),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      message: 'No fields to update',
    });
  });

  it('returns 200 on valid update', async () => {
    updateClientWebsiteProfile.mockResolvedValueOnce({ ok: true });
    const PATCH = await loadUpdate();
    const res = await PATCH(
      new NextRequest('http://localhost/api/client/update', {
        method: 'PATCH',
        body: JSON.stringify({ clientId: 123, address: 'Giza' }),
      }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(updateClientWebsiteProfile).toHaveBeenCalledWith({
      clientId: 123,
      address: 'Giza',
    });
  });
});

describe('POST /api/public/client/loyalty/rewards/[rewardId]/redeem', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function makeFakeDb(results: { recordset: unknown[] }[]) {
    let idx = 0;
    return {
      request: vi.fn(() => ({
        input: vi.fn().mockReturnThis(),
        query: vi.fn(async () => results[idx++] ?? { recordset: [] }),
      })),
    };
  }

  it('requires confirm: true', async () => {
    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => makeFakeDb([])),
      sql: {
        Int: () => ({}),
        Decimal: () => ({}),
        NVarChar: () => ({}),
        Transaction: class {
          async begin() {}
          async commit() {}
          async rollback() {}
        },
        Request: class {
          input() {
            return this;
          }
          async query() {
            return { recordset: [] };
          }
        },
        ISOLATION_LEVEL: { READ_COMMITTED: 0 },
      },
    }));

    const { POST } = await import(
      '@/app/api/public/client/loyalty/rewards/[rewardId]/redeem/route'
    );
    const res = await POST(
      new NextRequest(
        'http://localhost/api/public/client/loyalty/rewards/1/redeem?clientId=1',
        {
          method: 'POST',
          body: JSON.stringify({ confirm: false }),
        },
      ),
      { params: Promise.resolve({ rewardId: '1' }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Confirmation required');
  });

  it('is reachable without staff session via public prefix', () => {
    expect(classifyProxyAuth('/api/public/client/loyalty/rewards/5/redeem').kind).toBe(
      'anonymous_public',
    );
  });
});

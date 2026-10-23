import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn(), pool: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ requireAdmin: mocks.auth, isAuthResult: (v: unknown) => !(v instanceof NextResponse) }));
vi.mock('@/platform/tenant/legacyBootstrapSeam', () => ({ resolveLegacyBootstrapTenantId: async () => 'tenant-a' }));
vi.mock('@/lib/db', () => ({ getPool: mocks.pool, sql: { Date: 'date' } }));
import { GET } from '@/app/api/admin/hr/closing-history/route';

describe('manager closing history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ tenantId: 'tenant-a' });
    const request = { input: vi.fn().mockReturnThis(), query: mocks.query };
    mocks.pool.mockResolvedValue({ request: () => request });
  });
  it('rejects unauthenticated access without reading logs', async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await GET(new NextRequest('https://example.test/api/admin/hr/closing-history?month=2026-10'))).status).toBe(401);
    expect(mocks.pool).not.toHaveBeenCalled();
  });
  it('does not expose the legacy log to another tenant', async () => {
    mocks.auth.mockResolvedValue({ tenantId: 'tenant-b' });
    const response = await GET(new NextRequest('https://example.test/api/admin/hr/closing-history?month=2026-10'));
    expect(await response.json()).toMatchObject({ available: false, days: [], lastSuccessfulWorkDate: null });
    expect(mocks.pool).not.toHaveBeenCalled();
  });
  it.each(['2026-13', '2026-2', 'invalid', '9999-12'])('rejects invalid month %s', async month => {
    expect((await GET(new NextRequest(`https://example.test/api/admin/hr/closing-history?month=${month}`))).status).toBe(400);
    expect(mocks.pool).not.toHaveBeenCalled();
  });
  it('keeps last successful date across months while chart stays in selected month', async () => {
    mocks.query.mockResolvedValue({ recordset: [
      { WorkDate: '2026-09-30', Success: true, LastSuccessfulWorkDate: '2026-09-30' },
      { WorkDate: '2026-10-02', Success: false, LastSuccessfulWorkDate: '2026-09-30' },
    ] });
    const response = await GET(new NextRequest('https://example.test/api/admin/hr/closing-history?month=2026-10'));
    expect(await response.json()).toEqual({ available: true, month: '2026-10', lastSuccessfulWorkDate: '2026-09-30', days: [{ date: '2026-10-02', success: false }] });
  });
  it('reports an empty log without inventing a closed date', async () => {
    mocks.query.mockResolvedValue({ recordset: [] });
    const response = await GET(new NextRequest('https://example.test/api/admin/hr/closing-history?month=2026-10'));
    expect(await response.json()).toMatchObject({ available: true, lastSuccessfulWorkDate: null, days: [] });
  });
});

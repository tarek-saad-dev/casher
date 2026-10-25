import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({
  authenticateTenantShell: vi.fn(),
  isAuthResult: (value: unknown) => (value as { ok?: boolean })?.ok === true,
  isPlatformOperatorUser: vi.fn().mockResolvedValue(false),
}));
vi.mock('@/platform/tenant/tenantShellSnapshot', () => ({
  loadTenantShellSnapshot: vi.fn(),
}));

import { authenticateTenantShell } from '@/lib/api-auth';
import { loadTenantShellSnapshot } from '@/platform/tenant/tenantShellSnapshot';
import { GET } from '@/app/api/tenant/context/route';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LOCATION = '11111111-1111-4111-8111-111111111111';
const activeLocation = {
  locationId: LOCATION,
  legacyBranchId: 42,
  branchCode: 'NEW_BRANCH',
  timezone: 'Africa/Cairo',
};

describe('Core Workspace authenticated active Location', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateTenantShell).mockResolvedValue({
      ok: true,
      tenantId: TENANT,
      userId: 7,
      roles: ['admin'],
      tenant: { tenantCode: 'NEW_TENANT', activeLocation },
      subscription: { allowed: true, status: 'trial', reason: 'TRIAL_VALID' },
    } as never);
    vi.mocked(loadTenantShellSnapshot).mockResolvedValue({
      tenant: { tenantId: TENANT, code: 'NEW_TENANT', name: 'New Tenant', activeLocation },
      installedApps: ['booking'],
    } as never);
  });

  it('derives active Location from verified tenant session, never from route or browser request', async () => {
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(loadTenantShellSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT,
      tenantCode: 'NEW_TENANT',
      activeLocation,
    }));
    expect(body.tenant.activeLocation).toEqual(activeLocation);
  });

  it('does not load tenant data for unauthenticated callers', async () => {
    vi.mocked(authenticateTenantShell).mockResolvedValue(
      NextResponse.json({ code: 'SESSION_REQUIRED' }, { status: 401 }) as never,
    );
    const response = await GET();
    expect(response.status).toBe(401);
    expect(loadTenantShellSnapshot).not.toHaveBeenCalled();
  });

  it('types and maps the same canonical active Location in shell snapshot without a second resolver', () => {
    const read = (name: string) => fs.readFileSync(path.join(process.cwd(), name), 'utf8');
    const types = read('src/platform/tenant/tenantShellTypes.ts');
    const loader = read('src/platform/tenant/tenantShellSnapshot.ts');
    const route = read('src/app/api/tenant/context/route.ts');
    expect(types).toContain('activeLocation: TenantLocationRef');
    expect(loader).toContain('activeLocation: input.activeLocation');
    expect(route).toContain('activeLocation: auth.tenant.activeLocation');
    expect(route).toContain('authenticateTenantShell()');
  });
});

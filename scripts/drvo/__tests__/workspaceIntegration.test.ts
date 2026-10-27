import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import type { GoLiveMilestone, GoLiveMilestoneId, TenantGoLiveReport } from '@/platform/onboarding/goLiveTypes';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({
  requireAdmin: vi.fn(),
  isAuthResult: (auth: { ok?: boolean }) => auth?.ok === true,
}));
vi.mock('@/platform/commercial/tenantAccessGate', () => ({
  getTenantInstalledAppsForGate: vi.fn(),
}));
vi.mock('@/platform/onboarding/goLiveReadiness', () => ({
  evaluateTenantGoLive: vi.fn(),
}));

import { requireAdmin } from '@/lib/api-auth';
import { getTenantInstalledAppsForGate } from '@/platform/commercial/tenantAccessGate';
import { evaluateTenantGoLive } from '@/platform/onboarding/goLiveReadiness';
import {
  buildTenantWorkspace,
  pickPrimaryWorkspaceNextAction,
} from '@/platform/tenant/workspaceReadiness';
import { PUBLIC_SIGNUP_NEXT_PATH } from '@/platform/publicSignup/constants';
import { GET } from '@/app/api/tenant/workspace/route';
import fs from 'node:fs';
import path from 'node:path';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const ids: GoLiveMilestoneId[] = [
  'commercial_access', 'active_branch', 'catalog', 'team', 'users',
  'business_day', 'first_shift', 'first_sale', 'first_booking',
];

function report(input: {
  tenantId?: string;
  pending?: GoLiveMilestoneId[];
  omit?: GoLiveMilestoneId[];
} = {}): TenantGoLiveReport {
  const pending = new Set(input.pending ?? []);
  const omit = new Set(input.omit ?? []);
  const milestones: GoLiveMilestone[] = ids.filter((id) => !omit.has(id)).map((id) => ({
    id,
    label: id,
    detail: `Detail: ${id}`,
    status: pending.has(id) ? 'pending' : 'done',
    count: 1,
    action: `Action: ${id}`,
  }));
  return {
    tenantId: input.tenantId ?? TENANT_A,
    tenantCode: 'SALON_A',
    tenantName: 'Salon A',
    ownerLoginName: 'private-owner',
    bookingInstalled: true,
    status: 'IN_PROGRESS',
    completed: 0,
    total: milestones.length,
    progressPercent: 0,
    milestones,
    primaryBranch: { branchId: 1, branchCode: 'A', branchName: 'A' },
  };
}

describe('Core Workspace readiness projection', () => {
  it('does not confuse app installation with readiness', () => {
    const result = buildTenantWorkspace(
      report({ pending: ['catalog', 'team', 'business_day', 'first_shift', 'first_sale', 'first_booking'] }),
      ['booking', 'pos', 'queue', 'payroll'],
    );
    expect(result.installedCount).toBe(4);
    expect(result.needsSetupCount).toBe(3);
    expect(result.apps.find((a) => a.code === 'booking')?.status).toBe('needs_setup');
    expect(result.apps.find((a) => a.code === 'pos')?.status).toBe('needs_setup');
    expect(result.apps.find((a) => a.code === 'queue')?.status).toBe('needs_setup');
    expect(result.apps.find((a) => a.code === 'payroll')?.status).toBe('installed_unverified');
    expect(result.apps.find((a) => a.code === 'inventory')?.status).toBe('not_installed');
    expect(result.apps.find((a) => a.code === 'inventory')?.actionHref).toBeNull();
  });

  it('marks only basic tenant-wide evidence when a first transaction is absent', () => {
    const result = buildTenantWorkspace(
      report({ pending: ['first_booking', 'first_sale'] }),
      ['booking', 'pos', 'queue'],
    );
    for (const code of ['booking', 'pos', 'queue']) {
      expect(result.apps.find((a) => a.code === code)?.status).toBe('basics_present');
      expect(result.apps.find((a) => a.code === code)?.description).toContain('غير مؤكد');
    }
  });

  it('calls first usage evidence in_use without claiming comprehensive readiness', () => {
    const result = buildTenantWorkspace(report(), ['booking', 'pos', 'queue']);
    expect(result.apps.find((a) => a.code === 'booking')?.status).toBe('in_use');
    expect(result.apps.find((a) => a.code === 'pos')?.status).toBe('in_use');
    expect(result.apps.find((a) => a.code === 'queue')?.status).toBe('basics_present');
    expect(result.apps.find((a) => a.code === 'booking')?.description).toContain('لا يغني');
  });

  it('fails conservatively when a prerequisite milestone is missing altogether', () => {
    const result = buildTenantWorkspace(report({ omit: ['catalog'] }), ['booking', 'pos']);
    expect(result.apps.find((a) => a.code === 'booking')?.status).toBe('needs_setup');
    expect(result.apps.find((a) => a.code === 'pos')?.status).toBe('needs_setup');
    expect(result.apps.find((a) => a.code === 'booking')?.nextAction).toContain('راجع');
  });

  it('ignores unknown and duplicate installed app codes and never renders private owner login', () => {
    const result = buildTenantWorkspace(report(), ['booking', 'booking', 'unknown-app']);
    expect(result.installedCount).toBe(1);
    expect(result.apps).toHaveLength(12);
    expect(JSON.stringify(result)).not.toContain('private-owner');
    expect(JSON.stringify(result)).not.toContain(TENANT_B);
    expect(JSON.stringify(result)).not.toContain(TENANT_A);
  });

  it('picks needs_setup as the single primary next action before basics_present', () => {
    const snapshot = buildTenantWorkspace(
      report({ pending: ['catalog', 'first_booking', 'first_sale'] }),
      ['booking', 'pos', 'payroll'],
    );
    const primary = pickPrimaryWorkspaceNextAction(snapshot);
    expect(primary?.status).toBe('needs_setup');
    expect(primary?.appCode).toBe('booking');
    expect(primary?.href).toBe('/admin/services');
  });

  it('does not promote installed_unverified apps as the primary next action', () => {
    const snapshot = buildTenantWorkspace(
      report({ pending: ['first_booking', 'first_sale'] }),
      ['payroll', 'messaging'],
    );
    expect(pickPrimaryWorkspaceNextAction(snapshot)).toBeNull();
  });
});

describe('public signup → Workspace landing', () => {
  it('sends new tenants to /workspace, not floor operations', () => {
    expect(PUBLIC_SIGNUP_NEXT_PATH).toBe('/workspace');
    const service = fs.readFileSync(
      path.join(process.cwd(), 'src/platform/publicSignup/service.ts'),
      'utf8',
    );
    const flow = fs.readFileSync(
      path.join(process.cwd(), 'src/components/public/PublicSignupFlow.tsx'),
      'utf8',
    );
    expect(service).toContain('PUBLIC_SIGNUP_NEXT_PATH');
    expect(service).not.toMatch(/nextPath:\s*'\/operations'/);
    expect(flow).toContain('PUBLIC_SIGNUP_NEXT_PATH');
    expect(fs.existsSync(path.join(process.cwd(), 'src/app/workspace/page.tsx'))).toBe(true);
  });
});

describe('GET /api/tenant/workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, tenantId: TENANT_A } as never);
    vi.mocked(getTenantInstalledAppsForGate).mockResolvedValue(['booking', 'queue', 'pos']);
    vi.mocked(evaluateTenantGoLive).mockResolvedValue(report());
  });

  it('only reads the tenant resolved from admin session and returns no owner login or tenant ID', async () => {
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(evaluateTenantGoLive).toHaveBeenCalledWith(TENANT_A);
    expect(getTenantInstalledAppsForGate).toHaveBeenCalledWith(TENANT_A);
    expect(JSON.stringify(body)).not.toContain('private-owner');
    expect(JSON.stringify(body)).not.toContain(TENANT_A);
    expect(body.apps.find((a: { code: string }) => a.code === 'booking').status).toBe('in_use');
  });

  it('fails closed before any tenant query when auth rejects the caller', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(new NextResponse('forbidden', { status: 403 }) as never);
    const response = await GET();
    expect(response.status).toBe(403);
    expect(evaluateTenantGoLive).not.toHaveBeenCalled();
    expect(getTenantInstalledAppsForGate).not.toHaveBeenCalled();
  });

  it('rejects an unexpected report belonging to a different tenant', async () => {
    vi.mocked(evaluateTenantGoLive).mockResolvedValue(report({ tenantId: TENANT_B }));
    const response = await GET();
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain(TENANT_B);
  });

  it('returns a safe retryable error on unexpected read failure', async () => {
    vi.mocked(evaluateTenantGoLive).mockRejectedValue(new Error('SQL secret example'));
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.code).toBe('WORKSPACE_UNAVAILABLE');
    expect(JSON.stringify(body)).not.toContain('SQL secret example');
  });
});

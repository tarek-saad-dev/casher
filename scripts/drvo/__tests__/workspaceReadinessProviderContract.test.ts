import { describe, expect, it, vi } from 'vitest';
import type { TenantGoLiveReport } from '@/platform/onboarding/goLiveTypes';
import type { WorkspaceAppReadinessSignal, WorkspaceReadinessProvider } from '@/platform/tenant/workspaceReadinessSignals';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
  sql: { UniqueIdentifier: 'guid' },
}));

import { buildTenantWorkspace } from '@/platform/tenant/workspaceReadiness';
import { applyWorkspaceReadinessSignals } from '@/platform/tenant/workspaceReadinessSignals';
import { enrichTenantWorkspaceWithProviders } from '@/platform/tenant/workspaceSignalCollector';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function baseline() {
  const report = {
    tenantId: A,
    tenantCode: 'A',
    tenantName: 'A',
    ownerLoginName: null,
    bookingInstalled: true,
    status: 'IN_PROGRESS',
    completed: 0,
    total: 0,
    progressPercent: 0,
    milestones: [],
    primaryBranch: null,
  } as TenantGoLiveReport;
  return buildTenantWorkspace(report, ['booking', 'pos', 'inventory']);
}

function appCodeState(out: ReturnType<typeof baseline>, code: string) {
  return out.apps.find((app) => app.code === code);
}

function signal(
  appCode: WorkspaceAppReadinessSignal['appCode'],
  override: Partial<WorkspaceAppReadinessSignal> = {},
): WorkspaceAppReadinessSignal {
  return {
    tenantId: A,
    appCode,
    checks: [{ key: 'setup', state: 'pass', detail: 'Setup passed' }],
    usage: 'unknown',
    ...override,
  };
}

describe('Core Workspace app-readiness contract', () => {
  it('keeps an uninstalled app disabled even if a provider wrongly says ready', () => {
    const result = applyWorkspaceReadinessSignals(baseline(), A, [signal('payroll', { usage: 'observed' })]);
    expect(appCodeState(result, 'payroll')?.status).toBe('not_installed');
    expect(appCodeState(result, 'payroll')?.actionHref).toBeNull();
  });

  it('uses explicit failing readiness evidence and safely scoped setup links', () => {
    const result = applyWorkspaceReadinessSignals(baseline(), A, [
      signal('booking', { checks: [{ key: 'booking_settings', state: 'fail', detail: 'Configure booking', action: 'Open setup', actionHref: '/admin/booking' }] }),
    ]);
    expect(appCodeState(result, 'booking')).toMatchObject({
      status: 'needs_setup',
      description: 'Configure booking',
      nextAction: 'Open setup',
      actionHref: '/admin/booking',
    });
    expect(result.needsSetupCount).toBe(2); // Booking and POS (unconfigured baseline)
  });

  it('never exposes external or protocol-relative setup redirects', () => {
    for (const href of ['https://evil.test', '//evil.test', 'javascript:alert(1)', '/\\evil.test']) {
      const result = applyWorkspaceReadinessSignals(baseline(), A, [
        signal('booking', { checks: [{ key: 'setup', state: 'fail', detail: 'Missing', actionHref: href }] }),
      ]);
      expect(appCodeState(result, 'booking')?.actionHref).toBeNull();
    }
  });

  it('only counts observed first use when all checks pass', () => {
    const valid = applyWorkspaceReadinessSignals(baseline(), A, [signal('inventory', { usage: 'observed' })]);
    expect(appCodeState(valid, 'inventory')?.status).toBe('in_use');
    const unknown = applyWorkspaceReadinessSignals(baseline(), A, [
      signal('inventory', { usage: 'observed', checks: [{ key: 'setup', state: 'unknown', detail: 'Not audited' }] }),
    ]);
    expect(appCodeState(unknown, 'inventory')?.status).toBe('installed_unverified');
  });

  it('does not claim setup verified when usage evidence is unknown', () => {
    const unknown = applyWorkspaceReadinessSignals(baseline(), A, [
      signal('inventory', { usage: 'unknown' }),
    ]);
    expect(appCodeState(unknown, 'inventory')?.status).toBe('installed_unverified');

    const explicitlyNotObserved = applyWorkspaceReadinessSignals(baseline(), A, [
      signal('inventory', { usage: 'not_observed' }),
    ]);
    expect(appCodeState(explicitlyNotObserved, 'inventory')?.status).toBe('basics_present');
  });

  it('rejects duplicate evidence keys after whitespace normalization', () => {
    const result = applyWorkspaceReadinessSignals(baseline(), A, [
      signal('inventory', {
        usage: 'observed',
        checks: [
          { key: ' payment_ready ', state: 'pass', detail: 'Ready' },
          { key: 'payment_ready', state: 'pass', detail: 'Ready' },
        ],
      }),
    ]);
    expect(appCodeState(result, 'inventory')?.status).toBe('installed_unverified');
  });

  it('will not trust a foreign tenant signal or duplicate providers', () => {
    const foreign = applyWorkspaceReadinessSignals(baseline(), A, [signal('inventory', { tenantId: B, usage: 'observed' })]);
    expect(appCodeState(foreign, 'inventory')?.status).toBe('installed_unverified');
    const duplicate = applyWorkspaceReadinessSignals(baseline(), A, [
      signal('inventory', { usage: 'observed' }),
      signal('inventory', { usage: 'observed' }),
    ]);
    expect(appCodeState(duplicate, 'inventory')?.status).toBe('installed_unverified');
  });

  it('rejects empty/invalid evidence and avoids false-green, leaving unspecified apps unchanged', () => {
    const b = baseline();
    const result = applyWorkspaceReadinessSignals(b, A, [
      signal('inventory', { checks: [], usage: 'observed' }),
      signal('reports', { usage: 'observed' }),
    ]);
    expect(appCodeState(result, 'inventory')?.status).toBe('installed_unverified');
    expect(appCodeState(result, 'booking')?.status).toBe(appCodeState(b, 'booking')?.status);
    expect(appCodeState(result, 'reports')?.status).toBe('not_installed');
  });
});

describe('Workspace readiness provider collector', () => {
  it('passes one canonical tenant context to registered installed providers only', async () => {
    const inventory: WorkspaceReadinessProvider = {
      appCode: 'inventory', check: vi.fn().mockResolvedValue(signal('inventory', { usage: 'observed' })),
    };
    const payroll: WorkspaceReadinessProvider = {
      appCode: 'payroll', check: vi.fn().mockResolvedValue(signal('payroll', { usage: 'observed' })),
    };
    const out = await enrichTenantWorkspaceWithProviders(baseline(), A, [inventory, payroll]);
    expect(inventory.check).toHaveBeenCalledWith(A);
    expect(payroll.check).not.toHaveBeenCalled();
    expect(appCodeState(out, 'inventory')?.status).toBe('in_use');
  });

  it('isolates a failed module without losing other module evidence', async () => {
    const out = await enrichTenantWorkspaceWithProviders(baseline(), A, [
      { appCode: 'inventory', check: async () => { throw new Error('sensitive provider error'); } },
      { appCode: 'booking', check: async () => signal('booking', { usage: 'observed' }) },
    ]);
    expect(appCodeState(out, 'inventory')?.status).toBe('installed_unverified');
    expect(appCodeState(out, 'booking')?.status).toBe('in_use');
    expect(JSON.stringify(out)).not.toContain('sensitive provider error');
  });

  it('does not expose the foreign-tenant response from a defective provider', async () => {
    const out = await enrichTenantWorkspaceWithProviders(baseline(), A, [
      { appCode: 'inventory', check: async () => signal('inventory', { tenantId: B, usage: 'observed' }) },
    ]);
    expect(appCodeState(out, 'inventory')?.status).toBe('installed_unverified');
    expect(JSON.stringify(out)).not.toContain(B);
  });

  it('refuses missing tenant identity before calling any provider', async () => {
    const check = vi.fn().mockResolvedValue(signal('booking'));
    await expect(enrichTenantWorkspaceWithProviders(baseline(), '', [
      { appCode: 'booking', check },
    ])).rejects.toThrow('تعذر تحديد المنشأة');
    expect(check).not.toHaveBeenCalled();
  });

  it('preserves baseline semantics when no app providers are registered', async () => {
    const b = baseline();
    const out = await enrichTenantWorkspaceWithProviders(b, A, []);
    expect(out).toEqual(b);
  });
});

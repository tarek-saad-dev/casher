import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (text: string, inputs: Record<string, unknown>) => unknown[] | undefined;

const db = vi.hoisted(() => {
  const state = {
    queries: [] as Array<{ text: string; inputs: Record<string, unknown> }>,
    handler: (() => []) as (text: string, inputs: Record<string, unknown>) => unknown[] | undefined,
    committed: 0,
    rolledBack: 0,
    poolRequested: 0,
  };
  class FakeRequest {
    inputs: Record<string, unknown> = {};
    input(name: string, typeOrValue: unknown, value?: unknown) {
      this.inputs[name] = arguments.length >= 3 ? value : typeOrValue;
      return this;
    }
    async query(text: string) {
      state.queries.push({ text, inputs: { ...this.inputs } });
      return { recordset: state.handler(text, this.inputs) ?? [] };
    }
  }
  class FakeTransaction {
    async begin() {}
    async commit() {
      state.committed += 1;
    }
    async rollback() {
      state.rolledBack += 1;
    }
    request() {
      return new FakeRequest();
    }
  }
  const pool = { request: () => new FakeRequest() };
  return { state, FakeRequest, FakeTransaction, pool };
});

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => {
    db.state.poolRequested += 1;
    return db.pool;
  }),
  sql: {
    Request: db.FakeRequest,
    Transaction: db.FakeTransaction,
    UniqueIdentifier: 'uid',
    NVarChar: () => 'nvarchar',
    Int: 'int',
    Bit: 'bit',
    DateTime2: 'datetime2',
    MAX: -1,
  },
}));

vi.mock('@/lib/branch/bootstrap', () => ({
  assertBranchIdentityAvailable: vi.fn(async () => undefined),
}));

import { TenantAppError } from '@/platform/apps/errors';
import { uninstallTenantApp } from '@/platform/apps/tenantApps';
import { BootstrapTenantProtectedError } from '@/platform/commercial/bootstrapGuard';
import { CommercialError } from '@/platform/commercial/errors';
import { assertCanAddBranch, assertCanAddUser, evaluateLimit } from '@/platform/commercial/limits';
import {
  changeTenantPlan,
  transitionTenantSubscription,
} from '@/platform/commercial/subscriptionService';
import { provisionTenant } from '@/platform/onboarding/provisionTenant';
import { SALON_PACK } from '@/packs/salon/public';
import { findIndustryPack } from '@/packs';

const TENANT = '11111111-2222-3333-4444-555555555555';
const DAY = 24 * 60 * 60 * 1000;

const PLANS: Record<string, Record<string, unknown>> = {
  starter: { PlanCode: 'starter', DisplayName: 'Starter', IsPublic: 1, IsActive: 1, SortOrder: 10, MaxBranches: 1, MaxUsers: 5, TrialDays: 14, PastDueGraceDays: 7 },
  growth: { PlanCode: 'growth', DisplayName: 'Growth', IsPublic: 1, IsActive: 1, SortOrder: 20, MaxBranches: 3, MaxUsers: 20, TrialDays: 14, PastDueGraceDays: 7 },
  internal: { PlanCode: 'internal', DisplayName: 'Internal', IsPublic: 0, IsActive: 1, SortOrder: 1000, MaxBranches: null, MaxUsers: null, TrialDays: 0, PastDueGraceDays: 0 },
};

function subRow(over: Record<string, unknown> = {}) {
  return {
    TenantId: TENANT,
    PlanCode: 'starter',
    Status: 'active',
    Origin: 'onboarding',
    TrialStartedAt: null,
    TrialEndsAt: null,
    CurrentPeriodEndsAt: null,
    PastDueSince: null,
    SuspendedAt: null,
    CancelledAt: null,
    Revision: 3,
    ...over,
  };
}

function baseHandler(opts: {
  tenantCode?: string;
  sub?: Record<string, unknown> | null;
  usage?: { branches: number; users: number };
  installed?: string[];
  packCode?: string | null;
}): Handler {
  return (text, inputs) => {
    if (text.includes('sp_getapplock')) return [{ lockResult: 0 }];
    if (text.includes('INSERT INTO dbo.PlatformOutbox')) return [{ id: 1 }];
    if (text.includes('SELECT 1 AS ok FROM dbo.Tenant')) return [{ ok: 1 }];
    if (text.includes('SELECT Code FROM dbo.Tenant')) return [{ Code: opts.tenantCode ?? 'SALON_A' }];
    if (text.includes('FROM dbo.TenantSubscription')) return opts.sub ? [opts.sub] : [];
    if (text.includes('FROM dbo.SaaSPlan WHERE PlanCode')) {
      const plan = PLANS[String(inputs.planCode)];
      return plan ? [plan] : [];
    }
    if (text.includes('AS branches')) return [opts.usage ?? { branches: 0, users: 0 }];
    if (text.includes('FROM dbo.TenantAppEntitlement')) {
      return (opts.installed ?? []).map((code) => ({
        AppCode: code,
        Status: 'installed',
        Source: 'pack',
        InstalledAt: null,
        DisabledAt: null,
      }));
    }
    if (text.includes('FROM dbo.TenantIndustryPack')) {
      return opts.packCode ? [{ PackCode: opts.packCode, PackVersion: 1, ConfigJson: '{}' }] : [];
    }
    if (text.includes('SELECT @@ROWCOUNT AS changed')) return [{ changed: 1 }];
    return [];
  };
}

beforeEach(() => {
  db.state.queries = [];
  db.state.committed = 0;
  db.state.rolledBack = 0;
  db.state.poolRequested = 0;
  db.state.handler = () => [];
});

const actor = { actorUserId: 7 };

describe('DRVO-012 plan change', () => {
  it('starter -> growth updates only the subscription and never touches installed apps', async () => {
    let current = subRow();
    db.state.handler = (text, inputs) => {
      if (text.includes('UPDATE dbo.TenantSubscription')) {
        current = subRow({ PlanCode: inputs.planCode, Revision: inputs.revision, Origin: 'platform_admin' });
        return [];
      }
      if (text.includes('FROM dbo.TenantSubscription')) return [current];
      return baseHandler({ sub: current })(text, inputs);
    };

    const updated = await changeTenantPlan(TENANT, 'growth', { actor, expectedRevision: 3 });
    expect(updated.planCode).toBe('growth');
    expect(updated.revision).toBe(4);
    expect(db.state.committed).toBe(1);

    const texts = db.state.queries.map((q) => q.text);
    expect(texts.some((t) => t.includes('TenantAppEntitlement'))).toBe(false);
    expect(texts.some((t) => /DELETE\s+FROM/i.test(t))).toBe(false);
    const outbox = db.state.queries.find((q) => q.text.includes('INSERT INTO dbo.PlatformOutbox'));
    expect(outbox?.inputs.eventType).toBe('tenant.subscription.plan_changed');
    expect(JSON.parse(String(outbox?.inputs.payload))).toMatchObject({
      fromPlanCode: 'starter',
      toPlanCode: 'growth',
      installedAppsChanged: false,
    });
    expect(outbox?.inputs.idempotencyKey).toBe(`subscription:${TENANT}:rev:4`);
    expect(texts.findIndex((t) => t.includes('sp_getapplock'))).toBeLessThan(
      texts.findIndex((t) => t.includes('UPDATE dbo.TenantSubscription')),
    );
  });

  it('rejects stale expected revision', async () => {
    db.state.handler = baseHandler({ sub: subRow() });
    await expect(
      changeTenantPlan(TENANT, 'growth', { actor, expectedRevision: 2 }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(db.state.rolledBack).toBe(1);
  });

  it('protects CASHER_BOOT from commercial mutation', async () => {
    db.state.handler = baseHandler({ tenantCode: 'CASHER_BOOT', sub: subRow({ PlanCode: 'internal' }) });
    await expect(changeTenantPlan(TENANT, 'starter', { actor })).rejects.toBeInstanceOf(
      BootstrapTenantProtectedError,
    );
    await expect(
      transitionTenantSubscription(TENANT, 'suspend', { actor }),
    ).rejects.toBeInstanceOf(BootstrapTenantProtectedError);
    expect(db.state.queries.some((q) => q.text.includes('UPDATE dbo.TenantSubscription'))).toBe(false);
  });
});

describe('DRVO-012 subscription transitions (service)', () => {
  it('rejects invalid transitions and unknown actions', async () => {
    db.state.handler = baseHandler({ sub: subRow({ Status: 'trial', TrialEndsAt: new Date(Date.now() + DAY) }) });
    await expect(
      transitionTenantSubscription(TENANT, 'mark_past_due', { actor }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await expect(transitionTenantSubscription(TENANT, 'explode', { actor })).rejects.toBeInstanceOf(
      CommercialError,
    );
  });

  it('mark_past_due stamps PastDueSince and publishes status_changed', async () => {
    const now = new Date('2026-10-05T00:00:00Z');
    let current = subRow();
    db.state.handler = (text, inputs) => {
      if (text.includes('UPDATE dbo.TenantSubscription')) {
        expect(inputs.status).toBe('past_due');
        expect(inputs.pastDueSince).toEqual(now);
        current = subRow({ Status: 'past_due', PastDueSince: now, Revision: inputs.revision });
        return [];
      }
      if (text.includes('FROM dbo.TenantSubscription')) return [current];
      return baseHandler({ sub: current })(text, inputs);
    };
    const updated = await transitionTenantSubscription(TENANT, 'mark_past_due', { actor, now });
    expect(updated.status).toBe('past_due');
    const outbox = db.state.queries.find((q) => q.text.includes('INSERT INTO dbo.PlatformOutbox'));
    expect(outbox?.inputs.eventType).toBe('tenant.subscription.status_changed');
  });
});

describe('DRVO-012 cancel paid-period rule', () => {
  async function cancelFrom(from: Record<string, unknown>, now: Date) {
    let current = subRow(from);
    db.state.handler = (text, inputs) => {
      if (text.includes('UPDATE dbo.TenantSubscription')) {
        current = subRow({
          ...from,
          Status: inputs.status,
          CurrentPeriodEndsAt: inputs.periodEnd,
          CancelledAt: inputs.cancelledAt,
          Revision: inputs.revision,
        });
        return [];
      }
      if (text.includes('FROM dbo.TenantSubscription')) return [current];
      return baseHandler({ sub: current })(text, inputs);
    };
    return transitionTenantSubscription(TENANT, 'cancel', { actor, now });
  }

  it('cancel from active keeps the paid period end', async () => {
    const now = new Date('2026-10-05T00:00:00Z');
    const periodEnd = new Date(now.getTime() + 20 * DAY);
    const result = await cancelFrom({ Status: 'active', CurrentPeriodEndsAt: periodEnd }, now);
    expect(result.status).toBe('cancelled');
    expect(result.currentPeriodEndsAt?.getTime()).toBe(periodEnd.getTime());
  });

  it('cancel from suspended or past_due ends access now instead of re-granting it', async () => {
    const now = new Date('2026-10-05T00:00:00Z');
    const periodEnd = new Date(now.getTime() + 20 * DAY);
    const fromSuspended = await cancelFrom(
      { Status: 'suspended', CurrentPeriodEndsAt: periodEnd, SuspendedAt: now },
      now,
    );
    expect(fromSuspended.currentPeriodEndsAt?.getTime()).toBe(now.getTime());
    const fromPastDue = await cancelFrom(
      { Status: 'past_due', CurrentPeriodEndsAt: periodEnd, PastDueSince: new Date(now.getTime() - 10 * DAY) },
      now,
    );
    expect(fromPastDue.currentPeriodEndsAt?.getTime()).toBe(now.getTime());
  });
});

describe('DRVO-012 limits', () => {
  it('pure limit evaluation handles unlimited, at-limit and over-limit', () => {
    expect(evaluateLimit(null, 500)).toEqual({ limit: null, usage: 500, canAdd: true, overLimit: false });
    expect(evaluateLimit(1, 0)).toMatchObject({ canAdd: true, overLimit: false });
    expect(evaluateLimit(1, 1)).toMatchObject({ canAdd: false, overLimit: false });
    expect(evaluateLimit(3, 5)).toMatchObject({ canAdd: false, overLimit: true });
  });

  it('starter blocks a second branch and a sixth user; growth allows them', async () => {
    const tx = new db.FakeTransaction() as never;
    db.state.handler = baseHandler({ sub: subRow({ PlanCode: 'starter' }), usage: { branches: 1, users: 5 } });
    await expect(assertCanAddBranch(tx, TENANT)).rejects.toMatchObject({ code: 'BRANCH_LIMIT_REACHED' });
    await expect(assertCanAddUser(tx, TENANT)).rejects.toMatchObject({ code: 'USER_LIMIT_REACHED' });

    db.state.handler = baseHandler({ sub: subRow({ PlanCode: 'growth' }), usage: { branches: 1, users: 5 } });
    await expect(assertCanAddBranch(tx, TENANT)).resolves.toMatchObject({ allowed: true, reason: 'WITHIN_LIMIT' });
    await expect(assertCanAddUser(tx, TENANT)).resolves.toMatchObject({ allowed: true });
    expect(db.state.queries.some((q) => q.text.includes('sp_getapplock'))).toBe(true);
  });

  it('unlimited internal plan always allows; blocked subscription denies', async () => {
    const tx = new db.FakeTransaction() as never;
    db.state.handler = baseHandler({ sub: subRow({ PlanCode: 'internal' }), usage: { branches: 40, users: 900 } });
    await expect(assertCanAddBranch(tx, TENANT)).resolves.toMatchObject({ reason: 'UNLIMITED' });

    db.state.handler = baseHandler({
      sub: subRow({ Status: 'trial', TrialEndsAt: new Date(Date.now() - DAY) }),
      usage: { branches: 0, users: 0 },
    });
    await expect(assertCanAddBranch(tx, TENANT)).rejects.toMatchObject({ code: 'COMMERCIAL_ACCESS_BLOCKED' });

    db.state.handler = baseHandler({ sub: null });
    await expect(assertCanAddUser(tx, TENANT)).rejects.toMatchObject({ code: 'COMMERCIAL_ACCESS_BLOCKED' });
  });
});

describe('DRVO-012 uninstall safety', () => {
  it('disables via UPDATE only (no DELETE) and publishes tenant.app.disabled', async () => {
    db.state.handler = baseHandler({
      installed: ['booking', 'pos', 'payroll', 'attendance'],
      packCode: 'salon',
    });
    const result = await uninstallTenantApp(TENANT, 'payroll', { actor, resolvePack: findIndustryPack });
    expect(result.appCode).toBe('payroll');
    const texts = db.state.queries.map((q) => q.text);
    expect(texts.some((t) => /DELETE\s+FROM/i.test(t))).toBe(false);
    const disable = db.state.queries.find((q) => q.text.includes("Status = N'disabled'"));
    expect(disable?.inputs.code).toBe('payroll');
    expect(disable?.inputs.tenantId).toBe(TENANT);
    const outbox = db.state.queries.find((q) => q.text.includes('INSERT INTO dbo.PlatformOutbox'));
    expect(outbox?.inputs.eventType).toBe('tenant.app.disabled');
  });

  it('rejects removing pack-required apps and protects CASHER_BOOT', async () => {
    db.state.handler = baseHandler({ installed: ['booking', 'pos'], packCode: 'salon' });
    await expect(
      uninstallTenantApp(TENANT, 'booking', { actor, resolvePack: findIndustryPack }),
    ).rejects.toMatchObject({ code: 'REQUIRED_BY_PACK' });

    db.state.handler = baseHandler({ tenantCode: 'CASHER_BOOT', installed: ['booking', 'pos'] });
    await expect(
      uninstallTenantApp(TENANT, 'pos', { actor, resolvePack: findIndustryPack }),
    ).rejects.toBeInstanceOf(BootstrapTenantProtectedError);
  });
});

describe('DRVO-012 onboarding composition', () => {
  const baseInput = {
    tenantCode: 'SALON_NEW',
    tenantDisplayName: 'New Salon',
    defaultTimezone: 'Africa/Cairo',
    ownerUserName: 'Owner',
    ownerLoginName: 'owner_new',
    ownerPassword: 'x',
    firstBranchCode: 'NEW_BR',
    firstBranchName: 'New Branch',
    industryPack: SALON_PACK,
  };

  it('rejects an invalid composition before any database work', async () => {
    await expect(
      provisionTenant({ ...baseInput, appCustomizations: { add: ['purchasing'] } }, actor),
    ).rejects.toBeInstanceOf(TenantAppError);
    await expect(
      provisionTenant({ ...baseInput, appCustomizations: { remove: ['booking'] } }, actor),
    ).rejects.toMatchObject({ code: 'REQUIRED_BY_PACK' });
    await expect(
      provisionTenant({ ...baseInput, appCustomizations: { add: ['operations'] } }, actor),
    ).rejects.toMatchObject({ code: 'UNKNOWN_APP' });
    expect(db.state.poolRequested).toBe(0);
    expect(db.state.queries).toHaveLength(0);
  });
});

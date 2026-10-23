import 'server-only';
import { getPool, sql } from '@/lib/db';
import { getTenantPackState, installedAppCodes, listTenantApps } from '@/platform/apps/tenantApps';
import { assertNotBootstrapTenant } from '@/platform/commercial/bootstrapGuard';
import { getTenantSubscription, listPlans } from '@/platform/commercial/planRepository';
import type { SaaSPlanRecord } from '@/platform/commercial/types';
import type { IndustryPackDefinition } from '@/platform/packs/types';
import { TenantOnboardingError } from '../errors';
import { provisionTenant } from '../provisionTenant';
import { evaluateTenantReadiness } from '../tenantReadiness';
import type {
  ProvisionTenantActor,
  ProvisionTenantInput,
  ProvisionTenantResult,
  TenantReadinessReport,
} from '../types';
import { normalizeTenantCode } from '../validation';
import { hasBlockingIssues, validateOnboardingRequest } from './plan';
import {
  DEFAULT_STAGE_EXECUTORS,
  type OnboardingSetupContext,
  type OnboardingStageExecutor,
} from './setupStages';
import {
  ONBOARDING_STAGES,
  type OnboardingCoreSummary,
  type OnboardingRequest,
  type OnboardingResult,
  type OnboardingStageKey,
  type OnboardingStageResult,
} from './types';

export type OnboardingTarget = {
  tenantId: string;
  tenantCode: string;
  packCode: string;
  apps: string[];
  planCode: string | null;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  /** Branch code -> legacy BranchID, from this tenant's Locations only. */
  branchIds: Map<string, number>;
};

export type OnboardingDeps = {
  /** Industry packs are injected by the caller (platform does not import packs). */
  findPack: (packCode: string) => IndustryPackDefinition | null;
  loadPlans: () => Promise<SaaSPlanRecord[]>;
  provisionCore: (input: ProvisionTenantInput, actor: ProvisionTenantActor) => Promise<ProvisionTenantResult>;
  loadTarget: (tenantId: string) => Promise<OnboardingTarget | null>;
  /** Owner of an onboarded tenant by login name, scoped to the tenant's memberships. */
  findOwnerUserId: (tenantId: string, loginName: string) => Promise<number | null>;
  /** Throws for the bootstrap tenant. */
  assertNotBootstrap: (tenantId: string) => Promise<void>;
  evaluateReadiness: (tenantId: string, pack: IndustryPackDefinition) => Promise<TenantReadinessReport | null>;
  stages: Record<OnboardingStageKey, OnboardingStageExecutor>;
};

async function loadTargetFromSql(tenantId: string): Promise<OnboardingTarget | null> {
  const pool = await getPool();
  const tenant = await pool
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`SELECT TenantId, Code FROM dbo.Tenant WHERE TenantId = @tenantId;`);
  const row = tenant.recordset[0] as { Code: string } | undefined;
  if (!row) return null;
  const locations = await pool
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`SELECT BranchCode, LegacyBranchId FROM dbo.Location WHERE TenantId = @tenantId;`);
  const branchIds = new Map<string, number>();
  for (const loc of locations.recordset as Array<{ BranchCode: string; LegacyBranchId: number }>) {
    branchIds.set(String(loc.BranchCode).toUpperCase(), Number(loc.LegacyBranchId));
  }
  const [pack, apps, sub] = await Promise.all([
    getTenantPackState(pool, tenantId),
    listTenantApps(tenantId, { executor: pool }),
    getTenantSubscription(pool, tenantId),
  ]);
  return {
    tenantId: tenantId.toLowerCase(),
    tenantCode: String(row.Code),
    packCode: pack?.packCode ?? '',
    apps: installedAppCodes(apps),
    planCode: sub?.planCode ?? null,
    subscriptionStatus: sub?.status ?? null,
    trialEndsAt: sub?.trialEndsAt?.toISOString() ?? null,
    branchIds,
  };
}

async function findOwnerUserIdFromSql(tenantId: string, loginName: string): Promise<number | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('loginName', sql.NVarChar(50), loginName)
    .query(`
      SELECT u.UserID
      FROM dbo.TenantMembership m
      INNER JOIN dbo.TblUser u ON u.UserID = m.LegacyUserId AND ISNULL(u.isDeleted, 0) = 0
      INNER JOIN dbo.TblUserRoles ur ON ur.UserID = u.UserID
      INNER JOIN dbo.TblRoles r ON r.RoleID = ur.RoleID AND r.RoleKey = N'admin'
      WHERE m.TenantId = @tenantId AND u.loginName = @loginName;
    `);
  const row = result.recordset[0] as { UserID: number } | undefined;
  return row ? Number(row.UserID) : null;
}

export function defaultOnboardingDeps(
  findPack: (packCode: string) => IndustryPackDefinition | null,
): OnboardingDeps {
  return {
    findPack,
    loadPlans: async () => listPlans(await getPool()),
    provisionCore: provisionTenant,
    loadTarget: loadTargetFromSql,
    findOwnerUserId: findOwnerUserIdFromSql,
    assertNotBootstrap: async (tenantId) =>
      assertNotBootstrapTenant(await getPool(), tenantId, 'onboarding setup'),
    evaluateReadiness: async (tenantId, pack) =>
      evaluateTenantReadiness(tenantId, await getPool(), {
        resolvePack: (code) => (code === pack.packCode ? pack : null),
      }),
    stages: DEFAULT_STAGE_EXECUTORS,
  };
}

function toProvisionInput(req: OnboardingRequest, pack: IndustryPackDefinition): ProvisionTenantInput {
  const b = req.business;
  const first = req.branches[0]!;
  return {
    tenantCode: b.tenantCode,
    tenantDisplayName: b.businessName.trim(),
    defaultTimezone: b.timezone,
    ownerUserName: req.owner.displayName.trim(),
    ownerLoginName: req.owner.loginName.trim(),
    ownerPassword: req.owner.password,
    firstBranchCode: first.branchCode,
    firstBranchName: first.branchName.trim(),
    firstBranchShortName: first.shortName ?? null,
    firstBranchTimezone: first.timezone ?? null,
    branchAddress: first.address ?? null,
    branchPhone: first.phone ?? null,
    branchDefaultOpenTime: first.defaultOpenTime || null,
    branchDefaultCloseTime: first.defaultCloseTime || null,
    industryPack: pack,
    appCustomizations: { add: req.apps.add, remove: req.apps.remove },
    planCode: req.subscription.planCode,
    subscriptionStatus: req.subscription.status,
    brand: {
      logoUrl: b.logoUrl || null,
      phone: b.businessPhone || null,
      primaryColor: b.primaryColor || null,
      accentColor: b.accentColor || null,
      receiptFooter: b.receiptFooter || null,
    },
  };
}

function stageApplies(stage: OnboardingStageKey, ctx: OnboardingSetupContext, req: OnboardingRequest): boolean {
  switch (stage) {
    case 'branches':
      return req.branches.length > 1;
    case 'services':
      return req.services.length > 0;
    case 'team':
      return req.employees.length > 0;
    case 'users':
      return req.users.length > 0;
    case 'booking':
      return ctx.apps.includes('booking') && req.booking.length > 0;
    case 'ai':
      return ctx.apps.includes('ai-receptionist') && req.ai != null;
  }
}

const NEEDS_BRANCHES = new Set<OnboardingStageKey>(['team', 'users', 'booking']);

/**
 * Post-core setup. Stages run in order with their own transaction boundaries; a failed stage is
 * reported (never rolled back into the core) and branch-dependent stages are blocked behind it.
 */
export async function runOnboardingSetup(
  ctx: OnboardingSetupContext,
  req: OnboardingRequest,
  stages: Record<OnboardingStageKey, OnboardingStageExecutor>,
): Promise<OnboardingStageResult[]> {
  const results: OnboardingStageResult[] = [];
  let branchesFailed = false;
  for (const stage of ONBOARDING_STAGES) {
    if (!stageApplies(stage, ctx, req)) {
      results.push({ stage, status: 'skipped', created: 0, existing: 0 });
      continue;
    }
    if (branchesFailed && NEEDS_BRANCHES.has(stage)) {
      results.push({ stage, status: 'blocked', created: 0, existing: 0, message: 'Waiting for branches' });
      continue;
    }
    try {
      const outcome = await stages[stage](ctx, req);
      results.push({ stage, status: 'done', ...outcome });
    } catch (err) {
      if (stage === 'branches') branchesFailed = true;
      results.push({
        stage,
        status: 'failed',
        created: 0,
        existing: 0,
        message: err instanceof Error ? err.message : String(err),
        errorCode:
          err && typeof err === 'object' && 'code' in err && typeof err.code === 'string' ? err.code : undefined,
      });
    }
  }
  return results;
}

function isComplete(stages: OnboardingStageResult[]): boolean {
  return stages.every((s) => s.status === 'done' || s.status === 'skipped');
}

async function resolvePlan(deps: OnboardingDeps, planCode: string): Promise<SaaSPlanRecord | null> {
  const code = planCode.trim().toLowerCase();
  return (await deps.loadPlans()).find((p) => p.isActive && p.planCode === code) ?? null;
}

function assertValid(req: OnboardingRequest, pack: IndustryPackDefinition | null, plan: SaaSPlanRecord | null): void {
  const issues = validateOnboardingRequest(req, { pack, plan });
  if (hasBlockingIssues(issues)) {
    throw new TenantOnboardingError(
      'ONBOARDING_PLAN_INVALID',
      issues.find((i) => i.severity === 'error')!.message,
      400,
      { issues },
    );
  }
}

/** Create Business: core provisioning once, then tenant-scoped setup stages. */
export async function onboardBusiness(
  req: OnboardingRequest,
  actor: ProvisionTenantActor,
  deps: OnboardingDeps,
): Promise<OnboardingResult> {
  const pack = deps.findPack(req.business.industryPackCode);
  const plan = await resolvePlan(deps, req.subscription.planCode);
  assertValid(req, pack, plan);

  const core = await deps.provisionCore(toProvisionInput(req, pack!), actor);
  const target = await deps.loadTarget(core.tenantId);
  const branchIds = target?.branchIds ?? new Map<string, number>();
  if (!branchIds.size) branchIds.set(core.branchCode.toUpperCase(), core.legacyBranchId);

  const ctx: OnboardingSetupContext = {
    tenantId: core.tenantId,
    tenantCode: core.tenantCode,
    packCode: core.industryPackCode,
    apps: [...core.apps],
    ownerUserId: core.legacyUserId,
    actorUserId: actor.actorUserId,
    branchIds,
  };
  const stages = await runOnboardingSetup(ctx, req, deps.stages);
  const summary: OnboardingCoreSummary = {
    tenantId: core.tenantId,
    tenantCode: core.tenantCode,
    branchCode: core.branchCode,
    ownerLoginName: core.ownerLoginName,
    industryPackCode: core.industryPackCode,
    apps: core.apps,
    planCode: core.planCode,
    subscriptionStatus: core.subscriptionStatus,
    trialEndsAt: core.trialEndsAt,
  };
  return {
    core: summary,
    stages,
    complete: isComplete(stages),
    readiness: await deps.evaluateReadiness(core.tenantId, pack!),
  };
}

/** Retry Setup for an already created business. Never provisions a tenant. */
export async function retryOnboardingSetup(
  tenantId: string,
  req: OnboardingRequest,
  actor: ProvisionTenantActor,
  deps: OnboardingDeps,
): Promise<OnboardingResult> {
  await deps.assertNotBootstrap(tenantId);
  const target = await deps.loadTarget(tenantId);
  if (!target) throw new TenantOnboardingError('TENANT_NOT_FOUND', 'Business not found', 404);
  if (target.tenantCode !== normalizeTenantCode(req.business.tenantCode)) {
    throw new TenantOnboardingError('ONBOARDING_TARGET_INVALID', 'Setup data belongs to a different business', 409);
  }
  const pack = deps.findPack(target.packCode);
  if (!pack || pack.packCode !== req.business.industryPackCode) {
    throw new TenantOnboardingError('ONBOARDING_TARGET_INVALID', 'Industry does not match the business', 409);
  }
  const plan = await resolvePlan(deps, target.planCode ?? req.subscription.planCode);
  assertValid(req, pack, plan);

  const ownerUserId = await deps.findOwnerUserId(tenantId, req.owner.loginName.trim());
  if (ownerUserId == null) {
    throw new TenantOnboardingError('ONBOARDING_TARGET_INVALID', 'Owner of this business was not found', 409);
  }

  const ctx: OnboardingSetupContext = {
    tenantId: target.tenantId,
    tenantCode: target.tenantCode,
    packCode: target.packCode,
    apps: target.apps,
    ownerUserId,
    actorUserId: actor.actorUserId,
    branchIds: new Map(target.branchIds),
  };
  const stages = await runOnboardingSetup(ctx, req, deps.stages);
  const first = [...target.branchIds.keys()][0] ?? '';
  return {
    core: {
      tenantId: target.tenantId,
      tenantCode: target.tenantCode,
      branchCode: req.branches[0]?.branchCode.toUpperCase() ?? first,
      ownerLoginName: req.owner.loginName.trim(),
      industryPackCode: target.packCode,
      apps: target.apps as OnboardingCoreSummary['apps'],
      planCode: target.planCode ?? '',
      subscriptionStatus: target.subscriptionStatus ?? '',
      trialEndsAt: target.trialEndsAt,
    },
    stages,
    complete: isComplete(stages),
    readiness: await deps.evaluateReadiness(tenantId, pack),
  };
}

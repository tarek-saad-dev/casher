import 'server-only';
import { getPool, sql } from '@/lib/db';
import { getTenantPackState } from '@/platform/apps/tenantApps';
import { getTenantBrandProfileCached } from '@/platform/branding/brandRepository';
import { getTenantInstalledAppsForGate } from '@/platform/commercial/tenantAccessGate';
import { getPlan, getTenantSubscription } from '@/platform/commercial/planRepository';
import type { SubscriptionEvaluation } from '@/platform/commercial/types';
import type { TenantShellSnapshot } from './tenantShellTypes';

export type { TenantShellSnapshot } from './tenantShellTypes';

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export async function loadTenantShellSnapshot(input: {
  tenantId: string;
  tenantCode: string;
  evaluation: SubscriptionEvaluation;
  isPlatformOperator: boolean;
}): Promise<TenantShellSnapshot> {
  const pool = await getPool();
  const [tenantRow, brand, installedApps, pack, sub] = await Promise.all([
    pool
      .request()
      .input('tenantId', sql.UniqueIdentifier, input.tenantId)
      .query(`SELECT Name FROM dbo.Tenant WHERE TenantId = @tenantId;`),
    getTenantBrandProfileCached(input.tenantId),
    getTenantInstalledAppsForGate(input.tenantId),
    getTenantPackState(pool, input.tenantId),
    getTenantSubscription(pool, input.tenantId),
  ]);
  const plan = sub ? await getPlan(pool, sub.planCode) : null;
  const name = String((tenantRow.recordset[0] as { Name?: string } | undefined)?.Name ?? input.tenantCode);

  return {
    tenant: {
      tenantId: input.tenantId,
      code: input.tenantCode,
      name,
      industryPackCode: pack?.packCode ?? null,
    },
    brand: brand ?? {
      tenantId: input.tenantId,
      displayName: name,
      logoUrl: null,
      phone: null,
      address: null,
      primaryColor: null,
      accentColor: null,
      receiptFooter: null,
      timezone: 'UTC',
      publicBookingOrigins: [],
      revision: 0,
      updatedAt: null,
    },
    installedApps,
    subscription: {
      allowed: input.evaluation.allowed,
      status: input.evaluation.status,
      reason: input.evaluation.reason,
      warning: input.evaluation.warning ?? null,
      accessEndsAt: input.evaluation.accessEndsAt ?? null,
      planCode: sub?.planCode ?? null,
      planName: plan?.displayName ?? null,
      trialEndsAt: iso(sub?.trialEndsAt),
      pastDueSince: iso(sub?.pastDueSince),
      currentPeriodEndsAt: iso(sub?.currentPeriodEndsAt),
    },
    isPlatformOperator: input.isPlatformOperator,
  };
}

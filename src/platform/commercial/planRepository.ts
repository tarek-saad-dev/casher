import 'server-only';
import type { ConnectionPool, Transaction } from 'mssql';
import { sql } from '@/lib/db';
import type {
  SaaSPlanRecord,
  SubscriptionOrigin,
  SubscriptionStatus,
  TenantSubscriptionRecord,
} from './types';

export type SqlExecutor = ConnectionPool | Transaction;

function toDate(value: unknown): Date | null {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(String(value));
}

function mapPlan(row: Record<string, unknown>): SaaSPlanRecord {
  return {
    planCode: String(row.PlanCode),
    displayName: String(row.DisplayName),
    isPublic: Boolean(row.IsPublic),
    isActive: Boolean(row.IsActive),
    sortOrder: Number(row.SortOrder),
    maxBranches: row.MaxBranches == null ? null : Number(row.MaxBranches),
    maxUsers: row.MaxUsers == null ? null : Number(row.MaxUsers),
    trialDays: Number(row.TrialDays),
    pastDueGraceDays: Number(row.PastDueGraceDays),
  };
}

function mapSubscription(row: Record<string, unknown>): TenantSubscriptionRecord {
  return {
    tenantId: String(row.TenantId),
    planCode: String(row.PlanCode),
    status: String(row.Status) as SubscriptionStatus,
    origin: String(row.Origin) as SubscriptionOrigin,
    trialStartedAt: toDate(row.TrialStartedAt),
    trialEndsAt: toDate(row.TrialEndsAt),
    currentPeriodEndsAt: toDate(row.CurrentPeriodEndsAt),
    pastDueSince: toDate(row.PastDueSince),
    suspendedAt: toDate(row.SuspendedAt),
    cancelledAt: toDate(row.CancelledAt),
    revision: Number(row.Revision),
  };
}

const PLAN_COLUMNS = `PlanCode, DisplayName, IsPublic, IsActive, SortOrder,
  MaxBranches, MaxUsers, TrialDays, PastDueGraceDays`;

const SUBSCRIPTION_COLUMNS = `TenantId, PlanCode, Status, Origin, TrialStartedAt, TrialEndsAt,
  CurrentPeriodEndsAt, PastDueSince, SuspendedAt, CancelledAt, Revision`;

export async function listPlans(ex: SqlExecutor): Promise<SaaSPlanRecord[]> {
  const result = await ex.request().query(`
    SELECT ${PLAN_COLUMNS} FROM dbo.SaaSPlan ORDER BY SortOrder, PlanCode;
  `);
  return (result.recordset as Array<Record<string, unknown>>).map(mapPlan);
}

export async function getPlan(ex: SqlExecutor, planCode: string): Promise<SaaSPlanRecord | null> {
  const result = await ex
    .request()
    .input('planCode', sql.NVarChar(32), planCode)
    .query(`SELECT ${PLAN_COLUMNS} FROM dbo.SaaSPlan WHERE PlanCode = @planCode;`);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapPlan(row) : null;
}

export async function getTenantSubscription(
  ex: SqlExecutor,
  tenantId: string,
  opts: { forUpdate?: boolean } = {},
): Promise<TenantSubscriptionRecord | null> {
  const hint = opts.forUpdate ? 'WITH (UPDLOCK, HOLDLOCK)' : '';
  const result = await ex
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT ${SUBSCRIPTION_COLUMNS}
      FROM dbo.TenantSubscription ${hint}
      WHERE TenantId = @tenantId;
    `);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapSubscription(row) : null;
}

export async function tenantExists(ex: SqlExecutor, tenantId: string): Promise<boolean> {
  const result = await ex
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`SELECT 1 AS ok FROM dbo.Tenant WHERE TenantId = @tenantId;`);
  return result.recordset.length > 0;
}

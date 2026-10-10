import { AsyncLocalStorage } from 'node:async_hooks';
import {
  TenantContextError,
  buildJobTenantContext,
  type JobTenantContext,
} from '@/platform/tenant/tenantContext';

/**
 * Authoritative tenant for one unit of messaging work. Established only at entry points:
 * - staff routes: the DRVO-013 authenticated tenant
 * - inbound webhooks: the tenant owning the channel whose token authenticated the call
 * - workers: the TenantId of the claimed row (JobTenantContext)
 * - post-commit feature callers: the tenant owning the branch the event belongs to
 * There is no default tenant. Repositories call `requireMessagingTenantId` and fail closed.
 */
export type MessagingTenantSource = 'staff' | 'webhook' | 'job' | 'branch' | 'system-job';

export interface MessagingTenantScope {
  tenantId: string;
  source: MessagingTenantSource;
  detail: string;
}

const storage = new AsyncLocalStorage<MessagingTenantScope>();

function normalizeTenantId(tenantId: string | null | undefined, where: string): string {
  return buildJobTenantContext(tenantId, where).tenantId;
}

export function runWithMessagingTenant<T>(
  scope: { tenantId: string; source: MessagingTenantSource; detail: string },
  fn: () => Promise<T>,
): Promise<T> {
  const tenantId = normalizeTenantId(scope.tenantId, `messaging:${scope.source}:${scope.detail}`);
  const outer = storage.getStore();
  if (outer && outer.tenantId !== tenantId) {
    return Promise.reject(
      new TenantContextError(
        'TENANT_MEMBERSHIP_MISMATCH',
        `Nested messaging scope ${scope.source}:${scope.detail} targets another tenant than ${outer.source}:${outer.detail}`,
      ),
    );
  }
  return storage.run({ tenantId, source: scope.source, detail: scope.detail }, fn);
}

/** Worker entry: TenantId always comes from the claimed row. */
export function runWithMessagingJobTenant<T>(
  rowTenantId: string | null | undefined,
  source: string,
  fn: (job: JobTenantContext) => Promise<T>,
): Promise<T> {
  const job = buildJobTenantContext(rowTenantId, source);
  return runWithMessagingTenant({ tenantId: job.tenantId, source: 'job', detail: source }, () => fn(job));
}

export function currentMessagingTenantScope(): MessagingTenantScope | null {
  return storage.getStore() ?? null;
}

export function requireMessagingTenantId(where: string): string {
  const scope = storage.getStore();
  if (!scope) {
    throw new TenantContextError('TENANT_CONTEXT_UNRESOLVED', `${where}: messaging call without tenant scope`);
  }
  return scope.tenantId;
}

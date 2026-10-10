import { sql } from '@/lib/db';
import { requireMessagingTenantId } from './messagingTenantScope';

type InputRequest<R> = { input(name: string, type: unknown, value: unknown): R };

/**
 * Binds `@tenantId` from the ambient messaging scope. Every messaging statement filters or
 * stamps rows with it; calling outside a scope throws (fail closed, no default tenant).
 */
export function bindMessagingTenant<R extends InputRequest<R>>(request: R, where: string): R {
  return request.input('tenantId', sql.UniqueIdentifier, requireMessagingTenantId(where));
}

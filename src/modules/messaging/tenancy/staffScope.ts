import { runWithMessagingTenant } from './messagingTenantScope';

/** Staff route entry: the messaging tenant is the DRVO-013 authenticated tenant of the session. */
export function runWithStaffMessagingTenant<T>(
  auth: { tenantId: string },
  detail: string,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithMessagingTenant({ tenantId: auth.tenantId, source: 'staff', detail }, fn);
}

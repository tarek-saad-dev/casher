import { requireMessagingTenantId } from '../../tenancy/messagingTenantScope';

/**
 * Tenant whose public booking data the messaging AI reads: always the messaging tenant the
 * conversation runs under (DRVO-018). There is no CASHER_BOOT fallback; outside a messaging
 * tenant scope this rejects.
 */
export async function resolveMessagingBookingTenantId(): Promise<string> {
  return requireMessagingTenantId('messaging.booking');
}

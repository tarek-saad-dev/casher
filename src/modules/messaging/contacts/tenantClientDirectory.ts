import { lookupClientIdByPhone, type ClientPhoneLookupResult } from '@/lib/client/clientPhoneLookup';
import { requireMessagingTenantId } from '../tenancy/messagingTenantScope';

/**
 * The only path from messaging to customer master data (dbo.TblClient), which DRVO-015 owns.
 * Lookups run in the current messaging tenant through the tenant-scoped customer lookup, so a
 * customer of another tenant is indistinguishable from an unknown customer.
 */
export async function lookupTenantClientIdByPhone(phone: string): Promise<ClientPhoneLookupResult> {
  return lookupClientIdByPhone(requireMessagingTenantId('lookupTenantClientIdByPhone'), phone);
}

import 'server-only';
import {
  listPublicDiscoverableBranches,
  type PublicDiscoverableBranch,
} from '@/lib/booking/publicBookingBranchContext';
import { listPublicUpcomingBookings } from '@/lib/booking/publicBookingReader';
import { filterToCurrentTenantBranches } from '@/modules/messaging/tenancy/tenantBusinessScope';
import { requireMessagingTenantId } from '@/modules/messaging/tenancy/messagingTenantScope';

/**
 * Booking readers seen through the current messaging tenant. The public booking readers span
 * every branch in the database; the AI receptionist only ever sees its own tenant's locations
 * and the bookings made at them.
 */
export async function listTenantDiscoverableBranches(): Promise<PublicDiscoverableBranch[]> {
  const branches = await listPublicDiscoverableBranches();
  return filterToCurrentTenantBranches(branches, (b) => ({
    branchId: b.branchId,
    branchCode: b.branchCode,
  }));
}

export async function listTenantUpcomingBookings(
  args: Omit<Parameters<typeof listPublicUpcomingBookings>[0], 'tenantId'>,
): Promise<Awaited<ReturnType<typeof listPublicUpcomingBookings>>> {
  const result = await listPublicUpcomingBookings({
    ...args,
    tenantId: requireMessagingTenantId('listTenantUpcomingBookings'),
  });
  const bookings = await filterToCurrentTenantBranches(result.bookings, (b) => ({
    branchCode: b.branch?.branchCode ?? null,
  }));
  const removed = result.bookings.length - bookings.length;
  return {
    bookings,
    meta: { ...result.meta, count: Math.max(0, result.meta.count - removed) },
  };
}

/**
 * Public booking package resolution (plan / check-slot / create).
 *
 * Groom packages keep their package-level duration and do not require public
 * catalog membership (add-ons / home visits are not publicly bookable).
 * Regular packages are bundles of publicly bookable services: every included
 * service must be bookable at the branch, and duration comes from the branch
 * catalog — exactly like booking those services individually. Price stays
 * PackagePrice in both cases.
 */
import 'server-only';
import type { PublicBookingBranchContext } from '@/lib/booking/publicBookingBranchContext';
import { resolveSelectedBookingServices } from '@/lib/booking/bookingServiceDuration';
import {
  resolveGroomPackageBooking,
  type ResolvedGroomPackageBooking,
} from '@/lib/booking/groomPackageBooking';
import type { PackageKind } from '@/lib/migrations/ensureServicePackages';
import { requireMasterDataTenantId } from '@/platform/masterData/tenantScope';

export const PUBLIC_BOOKABLE_PACKAGE_KINDS: readonly PackageKind[] = ['groom', 'regular'];

export async function resolvePublicPackageBooking(args: {
  packageId: unknown;
  addonProIds?: unknown;
  clientServiceIds?: unknown;
  branchContext: PublicBookingBranchContext;
}): Promise<ResolvedGroomPackageBooking> {
  const pkg = await resolveGroomPackageBooking({
    packageId: args.packageId,
    addonProIds: args.addonProIds,
    clientServiceIds: args.clientServiceIds,
    allowedKinds: PUBLIC_BOOKABLE_PACKAGE_KINDS,
    tenantId: requireMasterDataTenantId(args.branchContext.tenantId, 'public package booking'),
  });
  if (pkg.packageKind !== 'regular') return pkg;

  const branch = await resolveSelectedBookingServices({
    branchContext: args.branchContext,
    serviceIds: pkg.requiredServiceIds,
  });
  const requiredLines = branch.services.map((line, idx) => ({
    ...line,
    price: idx === 0 ? pkg.packagePrice : 0,
  }));
  const addonDuration = pkg.addonLines.reduce((sum, l) => sum + l.durationMinutes, 0);
  const services = [...requiredLines, ...pkg.addonLines];

  return {
    ...pkg,
    packageDurationMinutes: branch.totalDurationMinutes,
    services,
    serviceIds: services.map((s) => s.serviceId),
    totalDurationMinutes: branch.totalDurationMinutes + addonDuration,
  };
}

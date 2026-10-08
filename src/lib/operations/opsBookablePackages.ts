/**
 * Packages offered by the /operations booking workspace for one branch.
 * Price / duration / services come from `resolvePublicPackageBooking` — the same
 * resolver plan, check-slot and create use — so the list matches what create accepts.
 */
import 'server-only';
import { BookingServiceDurationError } from '@/lib/booking/bookingServiceDuration';
import { GroomPackageBookingError } from '@/lib/booking/groomPackageBooking';
import { resolvePublicPackageBooking } from '@/lib/booking/packageBooking';
import {
  resolvePublicBookingBranchContext,
  type InternalPreviewAuth,
} from '@/lib/booking/publicBookingBranchContext';
import {
  PUBLIC_BOOKING_ERROR_CATALOG,
  type PublicBookingErrorCode,
} from '@/lib/booking/publicBookingErrorCatalog';
import { getPublicPackagesCatalog } from '@/lib/catalog/publicPackagesCatalog';
import type { OpsBookablePackage } from '@/lib/operations/opsBookablePackagesTypes';

const BRANCH_UNAVAILABLE_REASON = 'الباكدج غير متاح في هذا الفرع — خدمة أو أكثر من خدماته غير متاحة للحجز هنا';

function unavailableReasonFor(err: unknown): string | null {
  if (err instanceof BookingServiceDurationError) {
    return err.code === 'SERVICES_NOT_CONFIGURED'
      ? PUBLIC_BOOKING_ERROR_CATALOG.SERVICES_NOT_CONFIGURED.messageAr
      : BRANCH_UNAVAILABLE_REASON;
  }
  if (err instanceof GroomPackageBookingError) {
    const def = PUBLIC_BOOKING_ERROR_CATALOG[err.code as PublicBookingErrorCode];
    return def?.messageAr ?? 'الباكدج غير متاح للحجز';
  }
  return null;
}

export async function listOpsBookablePackages(args: {
  branchCode: string;
  tenantId: string;
  auth: InternalPreviewAuth;
}): Promise<{ branchCode: string; packages: OpsBookablePackage[] }> {
  const branchContext = await resolvePublicBookingBranchContext({
    branchCode: args.branchCode,
    purpose: 'internal_preview',
    auth: args.auth,
  });
  const catalog = await getPublicPackagesCatalog({ tenantId: args.tenantId });

  const packages = await Promise.all(
    catalog.packages.map(async (pkg): Promise<OpsBookablePackage> => {
      const base = {
        packageId: pkg.packageId,
        kind: pkg.kind,
        nameAr: pkg.nameAr,
        nameEn: pkg.nameEn,
        originalPrice: pkg.originalPrice,
      };
      try {
        const resolved = await resolvePublicPackageBooking({
          packageId: pkg.packageId,
          branchContext,
        });
        return {
          ...base,
          price: resolved.totalPrice,
          durationMinutes: resolved.totalDurationMinutes,
          serviceIds: resolved.serviceIds,
          services: resolved.services.map((s) => ({
            serviceId: s.serviceId,
            nameAr: s.nameAr || s.nameEn,
            price: s.price,
            durationMinutes: s.durationMinutes,
          })),
          available: true,
          unavailableReason: null,
        };
      } catch (err) {
        const reason = unavailableReasonFor(err);
        if (!reason) throw err;
        return {
          ...base,
          price: pkg.price,
          durationMinutes: pkg.durationMinutes ?? 0,
          serviceIds: [],
          services: pkg.includes
            .filter((i) => !i.optional)
            .map((i) => ({
              serviceId: i.serviceId,
              nameAr: i.nameAr,
              price: 0,
              durationMinutes: i.durationMinutes ?? 0,
            })),
          available: false,
          unavailableReason: reason,
        };
      }
    }),
  );

  return { branchCode: branchContext.branchCode, packages };
}

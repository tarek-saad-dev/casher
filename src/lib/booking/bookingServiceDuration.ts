/**
 * Booking Phase 4 — strict public booking duration/price from Phase-2 catalog.
 * No employee override, no system default, no name matching.
 */
import 'server-only';
import type { PublicBookingBranchContext } from '@/lib/booking/publicBookingBranchContext';
import { getPublicBookingServicesCatalog } from '@/lib/booking/publicBookingServices';
import { parsePublicServiceIdsParam } from '@/lib/booking/publicBookingBarberPolicy';

export type ResolvedBookingServiceLine = {
  serviceId: number;
  nameAr: string;
  nameEn: string;
  price: number;
  durationMinutes: number;
};

export type ResolvedSelectedBookingServices = {
  services: ResolvedBookingServiceLine[];
  serviceIds: number[];
  totalDurationMinutes: number;
  totalPrice: number;
};

export class BookingServiceDurationError extends Error {
  readonly code:
    | 'SERVICE_NOT_AVAILABLE_AT_BRANCH'
    | 'SERVICES_NOT_CONFIGURED'
    | 'INVALID_SERVICE_IDS';
  constructor(
    code:
      | 'SERVICE_NOT_AVAILABLE_AT_BRANCH'
      | 'SERVICES_NOT_CONFIGURED'
      | 'INVALID_SERVICE_IDS',
  ) {
    super(code);
    this.name = 'BookingServiceDurationError';
    this.code = code;
  }
}

/**
 * Resolve selected services strictly from the public Phase-2 catalog.
 * Duplicate IDs are normalized (first occurrence kept).
 * Invalid / non-public IDs throw — never silently dropped.
 */
export async function resolveSelectedBookingServices(args: {
  branchContext: PublicBookingBranchContext;
  serviceIds: Array<number | string | null | undefined> | string | null;
}): Promise<ResolvedSelectedBookingServices> {
  let requested: number[];
  if (typeof args.serviceIds === 'string') {
    const parsed = parsePublicServiceIdsParam(args.serviceIds);
    if (!parsed.ok) throw new BookingServiceDurationError('INVALID_SERVICE_IDS');
    requested = parsed.ids;
  } else {
    const parsed = parsePublicServiceIdsParam(
      (args.serviceIds ?? [])
        .filter((x) => x != null && x !== '')
        .map(String)
        .join(','),
    );
    if (!parsed.ok) throw new BookingServiceDurationError('INVALID_SERVICE_IDS');
    requested = parsed.ids;
  }

  if (requested.length === 0) {
    throw new BookingServiceDurationError('INVALID_SERVICE_IDS');
  }

  const catalog = await getPublicBookingServicesCatalog(args.branchContext);
  if (!catalog.services.length) {
    throw new BookingServiceDurationError('SERVICES_NOT_CONFIGURED');
  }

  const byId = new Map(catalog.services.map((s) => [s.serviceId, s]));
  const services: ResolvedBookingServiceLine[] = [];

  for (const id of requested) {
    const row = byId.get(id);
    if (!row) {
      throw new BookingServiceDurationError('SERVICE_NOT_AVAILABLE_AT_BRANCH');
    }
    if (
      !Number.isInteger(row.durationMinutes) ||
      row.durationMinutes <= 0 ||
      typeof row.price !== 'number' ||
      !Number.isFinite(row.price) ||
      row.price < 0
    ) {
      throw new BookingServiceDurationError('SERVICE_NOT_AVAILABLE_AT_BRANCH');
    }
    services.push({
      serviceId: row.serviceId,
      nameAr: row.nameAr,
      nameEn: row.nameEn,
      price: row.price,
      durationMinutes: row.durationMinutes,
    });
  }

  return {
    services,
    serviceIds: services.map((s) => s.serviceId),
    totalDurationMinutes: services.reduce((sum, s) => sum + s.durationMinutes, 0),
    totalPrice: services.reduce((sum, s) => sum + s.price, 0),
  };
}

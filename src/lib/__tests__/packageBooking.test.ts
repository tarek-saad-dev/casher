/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const resolveGroomPackageBooking = vi.fn();
const resolveSelectedBookingServices = vi.fn();

vi.mock('@/lib/booking/groomPackageBooking', () => ({
  resolveGroomPackageBooking: (...a: unknown[]) => resolveGroomPackageBooking(...a),
}));
vi.mock('@/lib/booking/bookingServiceDuration', () => ({
  resolveSelectedBookingServices: (...a: unknown[]) => resolveSelectedBookingServices(...a),
}));

import { resolvePublicPackageBooking } from '@/lib/booking/packageBooking';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const branchContext = { branchCode: 'GLEEM', branchId: 1, tenantId: TENANT_ID } as never;

function line(serviceId: number, price: number, durationMinutes: number) {
  return { serviceId, nameAr: `خ${serviceId}`, nameEn: `S${serviceId}`, price, durationMinutes };
}

function resolvedPackage(kind: 'regular' | 'groom') {
  const required = kind === 'regular' ? [9, 10, 22, 29] : [1049, 10];
  const price = kind === 'regular' ? 333 : 1300;
  const services = required.map((id, i) => line(id, i === 0 ? price : 0, 10));
  return {
    packageId: kind === 'regular' ? 7 : 1,
    packageKind: kind,
    nameEn: 'P',
    nameAr: 'P',
    packagePrice: price,
    packageDurationMinutes: kind === 'regular' ? 85 : 95,
    requiredServiceIds: required,
    addonProIds: [],
    services,
    serviceIds: required,
    addonLines: [],
    addonTotal: 0,
    totalPrice: price,
    totalDurationMinutes: kind === 'regular' ? 85 : 95,
    clientServiceIdsMismatch: false,
    metadataNote: `[groomPackage] packageId=${kind === 'regular' ? 7 : 1};packagePrice=${price};`,
  };
}

describe('resolvePublicPackageBooking', () => {
  beforeEach(() => {
    resolveGroomPackageBooking.mockReset();
    resolveSelectedBookingServices.mockReset();
  });

  it('allows groom and regular kinds', async () => {
    resolveGroomPackageBooking.mockResolvedValue(resolvedPackage('groom'));
    await resolvePublicPackageBooking({ packageId: 1, branchContext });
    expect(resolveGroomPackageBooking.mock.calls[0][0].allowedKinds).toEqual(['groom', 'regular']);
    expect(resolveGroomPackageBooking.mock.calls[0][0].tenantId).toBe(TENANT_ID);
  });

  it('refuses to resolve a package without the branch tenant', async () => {
    await expect(
      resolvePublicPackageBooking({ packageId: 1, branchContext: { branchCode: 'X', branchId: 9 } as never }),
    ).rejects.toMatchObject({ name: 'TenantContextError' });
    expect(resolveGroomPackageBooking).not.toHaveBeenCalled();
  });

  it('groom packages are returned unchanged (no branch catalog lookup)', async () => {
    const groom = resolvedPackage('groom');
    resolveGroomPackageBooking.mockResolvedValue(groom);
    const r = await resolvePublicPackageBooking({ packageId: 1, branchContext });
    expect(r).toBe(groom);
    expect(resolveSelectedBookingServices).not.toHaveBeenCalled();
  });

  it('regular package: branch catalog durations, PackagePrice on the first line only', async () => {
    resolveGroomPackageBooking.mockResolvedValue(resolvedPackage('regular'));
    resolveSelectedBookingServices.mockResolvedValue({
      services: [line(9, 200, 30), line(10, 100, 20), line(22, 120, 5), line(29, 300, 35)],
      serviceIds: [9, 10, 22, 29],
      totalDurationMinutes: 90,
      totalPrice: 720,
    });
    const r = await resolvePublicPackageBooking({ packageId: 7, branchContext });
    expect(resolveSelectedBookingServices).toHaveBeenCalledWith({
      branchContext,
      serviceIds: [9, 10, 22, 29],
    });
    expect(r.services.map((s) => s.price)).toEqual([333, 0, 0, 0]);
    expect(r.services.map((s) => s.durationMinutes)).toEqual([30, 20, 5, 35]);
    expect(r.totalPrice).toBe(333);
    expect(r.totalDurationMinutes).toBe(90);
    expect(r.serviceIds).toEqual([9, 10, 22, 29]);
  });

  it('regular package fails when an included service is not bookable at the branch', async () => {
    resolveGroomPackageBooking.mockResolvedValue(resolvedPackage('regular'));
    const err = Object.assign(new Error('SERVICE_NOT_AVAILABLE_AT_BRANCH'), {
      code: 'SERVICE_NOT_AVAILABLE_AT_BRANCH',
    });
    resolveSelectedBookingServices.mockRejectedValue(err);
    await expect(resolvePublicPackageBooking({ packageId: 7, branchContext })).rejects.toBe(err);
  });
});

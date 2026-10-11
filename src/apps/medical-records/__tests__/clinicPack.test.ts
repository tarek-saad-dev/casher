import { describe, expect, it } from 'vitest';
import { isBarberJob } from '@/lib/booking/publicBookingBarberPolicy';
import { JobType } from '@/lib/types';
import { resolveTenantComposition } from '@/platform/apps/compositionResolver';
import {
  defaultAcceptsBookings,
  usesServiceCatalog,
} from '@/platform/onboarding/wizard/plan';
import { CLINIC_PACK } from '@/packs/clinic/public';

describe('DRVO Clinics pack', () => {
  it('installs booking and medical records as required apps', () => {
    const composition = resolveTenantComposition(CLINIC_PACK);
    expect(composition.apps).toContain('booking');
    expect(composition.apps).toContain('medical-records');
    expect(composition.apps).toContain('pos');
    expect(composition.apps).toContain('treasury');
  });

  it('treats clinic as a service-catalog business', () => {
    expect(usesServiceCatalog('clinic')).toBe(true);
  });

  it('treats doctors as booking practitioners', () => {
    expect(JobType.DOCTOR).toBe('طبيب');
    expect(defaultAcceptsBookings(JobType.DOCTOR)).toBe(true);
    expect(isBarberJob('طبيب')).toBe(true);
    expect(isBarberJob('doctor')).toBe(true);
  });
});

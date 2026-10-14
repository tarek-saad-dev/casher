import { describe, expect, it } from 'vitest';
import { isBarberJob } from '@/lib/booking/publicBookingBarberPolicy';
import { JobType } from '@/lib/types';
import { resolveTenantComposition } from '@/platform/apps/compositionResolver';
import {
  defaultAcceptsBookings,
  usesServiceCatalog,
} from '@/platform/onboarding/wizard/plan';
import { CLINIC_PACK } from '@/packs/clinic/public';
import { getActiveNavItem, NAV_SECTIONS } from '@/components/layout/nav-config';
import { isRouteAvailable, requiredAppsForRoute } from '@/platform/tenant/navAppGating';
import { resolveRouteAppCode } from '@/platform/commercial/routeAppFamilies';
import { SYSTEM_PAGES } from '@/lib/pages-registry';

describe('DRVO Clinics pack', () => {
  it('exposes the clinical workspace in shared navigation and page permissions', () => {
    expect(NAV_SECTIONS.flatMap(section => section.items).some(item => item.href === '/clinic')).toBe(true);
    expect(getActiveNavItem('/clinic/encounters/visit-a')?.href).toBe('/clinic');
    expect(SYSTEM_PAGES.find(page => page.path === '/clinic')?.accessMode).toBe('all');
  });

  it('gates clinic pages and APIs on the installed medical-records app', () => {
    expect(requiredAppsForRoute('/clinic/encounters/visit-a')).toEqual(['medical-records']);
    expect(isRouteAvailable('/clinic', ['booking', 'pos'])).toBe(false);
    expect(isRouteAvailable('/clinic', ['medical-records'])).toBe(true);
    expect(resolveRouteAppCode('/api/clinic/practitioners')).toBe('medical-records');
    expect(requiredAppsForRoute('/clinics')).toBeNull();
  });
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

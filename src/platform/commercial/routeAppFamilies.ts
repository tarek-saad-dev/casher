import type { AppRegistryCode } from '@/platform/registry/constants';

/**
 * DRVO-013: installable-app ownership of staff API route families.
 *
 * Enforced at the two authoritative tenant chokepoints (`authenticate()` and the active branch
 * context), so every tenant-checked handler under a family is gated for the session tenant.
 * Longest prefix wins. Families not listed are Platform Core / Shared Domains (or Treasury,
 * deliberately ungated per DRVO-012) and need only the subscription gate.
 */
export const ROUTE_APP_FAMILIES: ReadonlyArray<{ prefix: string; app: AppRegistryCode }> = [
  { prefix: '/api/bookings', app: 'booking' },
  { prefix: '/api/barbers/available', app: 'booking' },
  { prefix: '/api/operations/bookings', app: 'booking' },
  { prefix: '/api/operations/booking-packages', app: 'booking' },
  { prefix: '/api/operations/affected-bookings', app: 'booking' },
  { prefix: '/api/admin/booking', app: 'booking' },
  { prefix: '/api/admin/booking-control', app: 'booking' },
  { prefix: '/api/admin/booking-debug', app: 'booking' },
  { prefix: '/api/admin/booking-settings', app: 'booking' },

  { prefix: '/api/queue', app: 'queue' },
  { prefix: '/api/operations/queue', app: 'queue' },
  { prefix: '/api/admin/cleanup-queue', app: 'queue' },

  { prefix: '/api/pos', app: 'pos' },
  { prefix: '/api/sales', app: 'pos' },

  { prefix: '/api/inventory', app: 'inventory' },
  { prefix: '/api/purchases', app: 'purchasing' },

  { prefix: '/api/admin/attendance', app: 'attendance' },
  { prefix: '/api/employees/attendance', app: 'attendance' },

  { prefix: '/api/payroll', app: 'payroll' },
  { prefix: '/api/admin/hr/daily-payroll', app: 'payroll' },
  { prefix: '/api/admin/hr/employee-ledger', app: 'payroll' },
  { prefix: '/api/admin/hr/payroll-gap-review', app: 'payroll' },
  { prefix: '/api/admin/hr/target-templates', app: 'payroll' },
  { prefix: '/api/admin/hr/employee-monthly-quick-review', app: 'payroll' },
  { prefix: '/api/admin/hr/employee-monthly-report', app: 'payroll' },
  { prefix: '/api/admin/hr/employee-monthly-sheet', app: 'payroll' },

  { prefix: '/api/reports', app: 'reports' },
  { prefix: '/api/admin/reports', app: 'reports' },

  // Cut Club store, client inventory and vouchers are Loyalty data (TblLoyalty*, TblClientInventory).
  { prefix: '/api/loyalty', app: 'loyalty' },
  { prefix: '/api/admin/store', app: 'loyalty' },
  { prefix: '/api/pos/client-inventory', app: 'loyalty' },
  { prefix: '/api/pos/client-inventory-by-phone', app: 'loyalty' },
  { prefix: '/api/pos/voucher', app: 'loyalty' },

  { prefix: '/api/admin/whatsapp', app: 'messaging' },
  { prefix: '/api/pos/whatsapp', app: 'messaging' },
  { prefix: '/api/admin/hr/employee-daily-whatsapp-report', app: 'messaging' },

  { prefix: '/api/admin/ai-concierge', app: 'ai-receptionist' },
  { prefix: '/api/admin/salon-concierge', app: 'ai-receptionist' },
];

/**
 * System-job routes inside an app family. Cron bearer calls never reach `authenticate()`, so they
 * check the app per tenant inside the fan-out (runTenantJobFanout) instead.
 */
export const ROUTE_APP_SYSTEM_JOB_ROUTES: readonly string[] = [
  '/api/payroll/daily/auto-generate',
  '/api/admin/attendance/auto-absence/run',
];

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** App that owns the route, or null for core/shared/ungated routes. */
export function resolveRouteAppCode(pathname: string | null | undefined): AppRegistryCode | null {
  if (!pathname) return null;
  let best: { prefix: string; app: AppRegistryCode } | null = null;
  for (const family of ROUTE_APP_FAMILIES) {
    if (matches(pathname, family.prefix) && (!best || family.prefix.length > best.prefix.length)) {
      best = family;
    }
  }
  return best?.app ?? null;
}

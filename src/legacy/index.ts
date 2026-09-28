/**
 * Legacy anti-corruption layer — adapters over current tables and src/lib.
 * New DRVO modules consume these adapters until extraction completes.
 */
export { createLegacyCustomersAdapter } from '@/shared/customers/public';
export { createLegacyCatalogAdapter } from '@/shared/catalog/public';
export { createLegacyWorkforceOccupancyAdapter } from '@/shared/workforce/public';
export { createLegacyOperationalCalendarAdapter } from '@/shared/operational-calendar/public';
export { createLegacyMoneyMovementAdapter } from '@/apps/treasury/public';

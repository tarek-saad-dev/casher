import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('Salon Booking pilot — existing modular seam', () => {
  it('publishes typed scheduling ports rather than copying legacy internals', () => {
    const ports = source('src/apps/booking/public/ports.ts');
    for (const dependency of ['customers: CustomersPort', 'catalog: CatalogPort', 'occupancy: OccupancyPort', 'calendar: OperationalCalendarPort', 'conversion: BookingConversionPort', 'publishOutbox:']) {
      expect(ports).toContain(dependency);
    }
  });

  it('preserves occupancy serialization and durable booking events in the adapter', () => {
    const adapter = source('src/apps/booking/internal/schedulingPortAdapter.ts');
    for (const method of ['upsertCustomer(', 'assertEmployeeFree(', 'acquireEmpIntervalLock(', 'acquireAnyBarberLock(', 'commitOccupancy(', 'releaseOccupancy(', 'publishSchedulingEvent(']) {
      expect(adapter).toContain(method);
    }
    expect(adapter).toContain('deps.occupancy.lock(tx, deps.actor');
    expect(adapter).toContain('deps.publishOutbox(tx,');
  });

  it('keeps Booking mandatory in the Salon recipe, not dependent on POS', () => {
    const manifest = source('src/packs/salon/manifest.ts');
    expect(manifest).toContain("required: ['booking']");
    expect(manifest).toContain("recommended: ['queue', 'pos'");
    expect(manifest).toContain('...APP_REGISTRY_CODES');
  });

  it('retains staging booking lifecycle and synthetic cleanup acceptance script', () => {
    const smoke = source('scripts/drvo/salon-booking-e2e-staging.ts');
    for (const operation of ['createPublicBooking(', 'reschedulePublicBooking(', 'cancelPublicBooking(', 'purgeSmokeTenant(', 'Synthetic salon cleaned completely', 'process.exit(0)', 'process.exit(1)']) {
      expect(smoke).toContain(operation);
    }
  });
});

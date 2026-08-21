/**
 * Booking V2 B9.5 — tests for bootstrap bottleneck fix + warm zero heavy preload.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

describe('B9.5 bootstrap cold-path hardening', () => {
  it('bootstrap does not pass date into barbers (schedule N+1 killer)', () => {
    const src = readFileSync(
      join(root, 'src/lib/booking/v2Frontend/buildPublicBootstrap.ts'),
      'utf8',
    );
    expect(src).toContain("mode: 'global'");
    expect(src).toContain('Do NOT pass `date`');
    // Must not call listPublicBookingBarbers with date: today
    expect(src).not.toMatch(/listPublicBookingBarbers\(\{[\s\S]*date:\s*today/);
  });

  it('bootstrap uses L1 + SQL snapshot + CDN Cache-Control', () => {
    const boot = readFileSync(
      join(root, 'src/lib/booking/v2Frontend/buildPublicBootstrap.ts'),
      'utf8',
    );
    const route = readFileSync(
      join(root, 'src/app/api/public/booking/v2/bootstrap/route.ts'),
      'utf8',
    );
    expect(boot).toContain('getBootstrapSqlStore');
    expect(boot).toContain("source: 'sql'");
    expect(route).toContain('max-age=300');
    expect(route).toContain('stale-while-revalidate=3600');
    expect(route).toContain('ETag');
  });

  it('SQL bootstrap snapshot migration exists', () => {
    const sql = readFileSync(
      join(root, 'db/migrations/create-booking-bootstrap-snapshot.sql'),
      'utf8',
    );
    expect(sql).toContain('TblBookingBootstrapSnapshot');
  });

  it('14-day miss rebuild is single batched SoT preload', () => {
    const src = readFileSync(
      join(root, 'src/lib/booking/cache/rebuildHotPayloadsForMissKeys.ts'),
      'utf8',
    );
    expect(src).toContain('loadWeeklyBaselineSourceInputsBatch');
    expect(src).toContain('loadBookingOccupancyIntervalsRangeBatch');
    expect(src).toContain('In-memory: build N day payloads');
  });

  it('discoverable branches use batched visibility', () => {
    const src = readFileSync(
      join(root, 'src/lib/booking/publicBookingBranchContext.ts'),
      'utf8',
    );
    expect(src).toContain('canBranchesAppearInPublicBooking');
  });
});

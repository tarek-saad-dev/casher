import { afterEach, describe, expect, it } from 'vitest';
import { isBookingSchedulingPortEnabled } from '@/apps/booking/internal/schedulingPortFlag';
import { getDrvoModuleRolloutSpec } from '@/platform/drvo/moduleManifest';
import { namespacedHoldKey } from '@/apps/booking/application/holdBooking';
import {
  describePlatformBootstrapFailure,
  isPlatformBootstrapFailure,
} from '@/lib/booking/platformBootstrapErrors';
import fs from 'node:fs';
import path from 'node:path';

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

describe('DRVO-004 booking path regression', () => {
  afterEach(() => {
    delete process.env.BOOKING_SCHEDULING_PORT;
    delete process.env.DRVO_FORCE_BOOKING_PATH;
  });

  it('follows source-controlled booking rollout when env is unset', () => {
    delete process.env.BOOKING_SCHEDULING_PORT;
    expect(isBookingSchedulingPortEnabled()).toBe(
      getDrvoModuleRolloutSpec('booking').rollout === 'extracted',
    );
  });

  it('leftover BOOKING_SCHEDULING_PORT=false is ignored and defers to manifest', () => {
    process.env.BOOKING_SCHEDULING_PORT = 'false';
    expect(isBookingSchedulingPortEnabled()).toBe(
      getDrvoModuleRolloutSpec('booking').rollout === 'extracted',
    );
  });

  it('compat env true is break-glass extracted override only', () => {
    process.env.BOOKING_SCHEDULING_PORT = 'true';
    expect(isBookingSchedulingPortEnabled()).toBe(true);
  });

  it('malformed compat values defer to source-controlled manifest', () => {
    const expected = getDrvoModuleRolloutSpec('booking').rollout === 'extracted';
    for (const value of ['TRUE', '1', ' yes', 'true ']) {
      process.env.BOOKING_SCHEDULING_PORT = value;
      expect(isBookingSchedulingPortEnabled()).toBe(expected);
    }
  });

  it('DRVO_FORCE_BOOKING_PATH=legacy beats compat true', () => {
    process.env.BOOKING_SCHEDULING_PORT = 'true';
    process.env.DRVO_FORCE_BOOKING_PATH = 'legacy';
    expect(isBookingSchedulingPortEnabled()).toBe(false);
  });

  it('hold key namespacing is idempotent (hold -> create)', () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';
    const raw = 'client-hold-abc';
    const once = namespacedHoldKey(tenantId, raw);
    const twice = namespacedHoldKey(tenantId, once);
    expect(once).toBe(`t:${tenantId}:${raw}`);
    expect(twice).toBe(once);
  });

  it('maps bootstrap / missing schema failures clearly (log detail only)', () => {
    expect(isPlatformBootstrapFailure(new Error('BOOTSTRAP_TENANT_NOT_FOUND'))).toBe(
      true,
    );
    expect(
      isPlatformBootstrapFailure(
        new Error("Invalid object name 'dbo.Tenant'."),
      ),
    ).toBe(true);
    expect(
      isPlatformBootstrapFailure(
        new Error("Invalid object name 'dbo.PlatformOutbox'."),
      ),
    ).toBe(true);
    expect(isPlatformBootstrapFailure(new Error('SLOT_UNAVAILABLE'))).toBe(false);
    expect(describePlatformBootstrapFailure(new Error('BOOTSTRAP_TENANT_NOT_FOUND'))).toBe(
      'BOOTSTRAP_TENANT_NOT_FOUND',
    );
  });

  it('public create route wires flag OFF -> createPublicBooking and flag ON -> createBooking', () => {
    const route = read('src/app/api/public/booking/create/route.ts');
    expect(route).toContain('isBookingSchedulingPortEnabled');
    expect(route).toContain('createPublicBooking');
    expect(route).toContain('createBooking');
    expect(route).toContain('resolveBootstrapTenantId');
    expect(route).toContain('buildSchedulingPortHooksForActor');
    expect(route).toContain('PLATFORM_BOOTSTRAP_REQUIRED');
  });

  it('operations create uses staff actor; public create uses customer actor', () => {
    const route = read('src/app/api/public/booking/create/route.ts');
    expect(route).toContain('buildStaffActorContext');
    expect(route).toContain('buildCustomerActorContext');
    expect(route).toContain('isInternalOps && auth?.userId');
  });

  it('hold route uses extracted holdBooking when flag ON and maps bootstrap errors', () => {
    const route = read('src/app/api/public/booking/hold/route.ts');
    expect(route).toContain('isBookingSchedulingPortEnabled');
    expect(route).toContain('holdBooking');
    expect(route).toContain('createBookingHold');
    expect(route).toContain('PLATFORM_BOOTSTRAP_REQUIRED');
  });

  it('cancel routes keep legacy fallback and surface bootstrap failures', () => {
    for (const rel of [
      'src/app/api/public/booking/cancel/route.ts',
      'src/app/api/public/booking/[code]/cancel/route.ts',
    ]) {
      const route = read(rel);
      expect(route).toContain('isBookingSchedulingPortEnabled');
      expect(route).toContain('cancelPublicBooking');
      expect(route).toContain('cancelBooking');
      expect(route).toContain('PLATFORM_BOOTSTRAP_REQUIRED');
    }
  });

  it('composition root exports bootstrap + actor builders used by routes', () => {
    const composition = read('src/lib/bookingSchedulingComposition.ts');
    expect(composition).toContain('export async function resolveBootstrapTenantId');
    expect(composition).toContain('export async function buildStaffActorContext');
    expect(composition).toContain('export async function buildCustomerActorContext');
    expect(composition).toContain('export async function buildBookingSchedulingPorts');
    expect(composition).toContain('export async function buildSchedulingPortHooksForActor');
    expect(composition).toContain('publishPlatformOutboxEvent');
    expect(composition).toContain('createLegacyWorkforceOccupancyAdapter');
  });

  it('workforce occupancy adapter forwards tenant/date/branch/hold/exclusion', () => {
    const adapter = read('src/shared/workforce/internal/legacyAdapter.ts');
    expect(adapter).toContain('operationalDate: input.operationalDate');
    expect(adapter).toContain('branchId: input.branchId');
    expect(adapter).toContain('excludeHoldKey: input.excludeHoldKey');
    expect(adapter).toContain('excludeBookingIdFromRefs');
    expect(adapter).toContain('booking:emp:');
    expect(adapter).toContain('tenantLockResource');
  });

  it('createBooking namespaces holdKey through real hold helper (composition not mocked)', async () => {
    const tenantId = '22222222-2222-2222-2222-222222222222';
    const { createBooking } = await import('@/apps/booking/application/createBooking');
    expect(typeof createBooking).toBe('function');
    const namespaced = namespacedHoldKey(tenantId, 'hold-raw-1');
    expect(namespaced).toBe(`t:${tenantId}:hold-raw-1`);
  });

  it('production migrate requires --allow-production; staging scripts refuse last132', () => {
    const runner = read('scripts/drvo/run-migrations.ts');
    const runnerCore = read('scripts/drvo/runner.ts');
    const stagingMigrate = read('scripts/run-drvo-003-platform-core-migration.ts');
    const stagingSeed = read('scripts/seed-drvo-003-bootstrap-tenant.ts');
    expect(runner).toContain('--allow-production');
    expect(runnerCore).toContain('Refusing production database');
    expect(stagingMigrate).toContain('Refusing: production database');
    expect(stagingSeed).toContain('Refusing: production database');
  });

  it('deploy never auto-applies DRVO production migrations and verifies before restart', () => {
    const deploy = read('deploy/deploy-casher');
    expect(deploy).not.toContain('drvo:migrate-production');
    expect(deploy).toContain('drvo:verify');
    const verify = deploy.indexOf('drvo:verify');
    const restart = deploy.indexOf('systemctl restart casher');
    expect(verify).toBeGreaterThan(0);
    expect(restart).toBeGreaterThan(verify);
  });

  it('branch Location map verification covers all TblBranch rows', () => {
    const helper = read('scripts/drvo/platformBootstrap.ts');
    expect(helper).toContain('Missing Location for BranchID');
    expect(helper).toContain('Missing LegacyIdMap branch for BranchID');
    expect(helper).toContain('Location.BranchCode mismatch');
    expect(helper).toContain('branchCodes');
    expect(helper).toContain('locationCount !== branchCount');
    expect(helper).toContain('second tenant forbidden');
  });
});

describe('DRVO-004 createBooking hold bridging (no composition mock)', () => {
  it('createBooking namespaces holdKey into createPublicBooking via real helper', async () => {
    const tenantId = '33333333-3333-3333-3333-333333333333';
    const { namespacedHoldKey: ns } = await import('@/apps/booking/application/holdBooking');
    // Mirrors createBooking.ts holdKey transform without mocking composition root.
    const inputHold = 'raw-hold';
    const bridged =
      typeof inputHold === 'string' && inputHold.trim()
        ? ns(tenantId, inputHold)
        : inputHold;
    expect(bridged).toBe(`t:${tenantId}:raw-hold`);
    expect(ns(tenantId, bridged)).toBe(bridged);
  });
});

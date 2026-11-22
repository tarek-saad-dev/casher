/**
 * Stage-only runner source contract: reviewed service must not touch production,
 * deliver WhatsApp, or skip synthetic tenant cleanup.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const script = fs.readFileSync(
  path.join(root, 'scripts/drvo/drvo013-two-salon-booking-isolation-staging.ts'), 'utf8',
);
const workflow = fs.readFileSync(
  path.join(root, '.github/workflows/drvo013-two-salon-staging.yml'), 'utf8',
);

describe('DRVO-013 stage-only two Salon proof contract', () => {
  it('pins exact staging database, login and local SSH tunnel rather than production', () => {
    expect(script).toContain("const DB = 'last132_agent'");
    expect(script).toContain("const LOGIN = 'drvo_agent'");
    expect(script).toContain("const HOST = '127.0.0.1'");
    expect(script).toContain('if (process.env.DB_DATABASE === \'last132\'');
    expect(script).toContain('await assertStaging(pool);');
    expect(script).toContain('const { purgeSmokeTenant }');
  });

  it('never invokes real provider delivery or the legacy notification worker', () => {
    expect(script).not.toContain('sendViaTenantChannel(');
    expect(script).not.toContain('processPlatformOutboxTick(');
    expect(script).not.toContain('scheduleBookingWhatsAppAfterCommit(');
    expect(script).toContain('ExternalNotificationsEnabled=0');
    expect(script).toContain('no provider-facing Booking outbox events');
  });

  it('has two real synthetic Salon tenancy and booking contact boundary assertions', () => {
    expect(script).toContain("industry: 'salon'");
    expect(script).toContain('const a = await createSalon(1);');
    expect(script).toContain('const b = await createSalon(2);');
    expect(script).toContain('loadBookingCustomerContactForTenant(b.bookingId, a.tenantId)');
    expect(script).toContain('loadBookingCustomerContactForTenant(a.bookingId, b.tenantId)');
    expect(script).toContain('await purgeSmokeTenant(pool, code)');
    expect(script).toContain('DRVO013_TWO_SALON_BOOKING_SQL_ISOLATION_PASS');
  });

  it('CI requires same-repository exact branch plus protected staging environment', () => {
    expect(workflow).toContain('github.event.pull_request.head.repo.full_name == github.repository');
    expect(workflow).toContain("github.event.pull_request.head.ref == 'fix/drvo013-outbox-booking-tenant-guard-20261122'");
    expect(workflow).toContain('environment: drvo-staging');
    expect(workflow).toContain('ref: ${{ github.event.pull_request.head.sha }}');
    expect(workflow).toContain('DRVO_STAGING_DB_PASSWORD');
    expect(workflow).not.toContain('drvo:migrate');
    expect(workflow).not.toContain('migrate-production');
  });
});

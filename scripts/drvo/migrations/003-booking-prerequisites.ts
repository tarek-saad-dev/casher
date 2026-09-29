import { sha256Hex } from '../checksum';
import { verifyPlatformBootstrap } from '../platformBootstrap';
import type { DrvoMigrationDefinition } from '../types';

export const bookingPrerequisitesMigration: DrvoMigrationDefinition = {
  migrationId: 3,
  migrationKey: 'booking-prerequisites',
  name: 'DRVO-004 Booking scheduling prerequisites',
  dependencies: ['platform-bootstrap'],
  checksum: sha256Hex('booking-prerequisites-v1'),
  async apply(ctx) {
    const report = await verifyPlatformBootstrap(ctx.pool);
    if (!report.ok) {
      throw new Error(`Booking prerequisites failed: ${report.failures.join('; ')}`);
    }
  },
  async verify(ctx) {
    const report = await verifyPlatformBootstrap(ctx.pool);
    return { ok: report.ok, failures: report.failures };
  },
  async reconcileBaseline(ctx) {
    const report = await verifyPlatformBootstrap(ctx.pool);
    return report.ok;
  },
};

import { sha256Hex } from '../checksum';
import { verifyPlatformBootstrap } from '../platformBootstrap';
import type { DrvoMigrationDefinition } from '../types';

export const queuePrerequisitesMigration: DrvoMigrationDefinition = {
  migrationId: 4,
  migrationKey: 'queue-prerequisites',
  name: 'DRVO-005 Queue scheduling prerequisites',
  dependencies: ['platform-bootstrap'],
  checksum: sha256Hex('queue-prerequisites-v1'),
  async apply(ctx) {
    const report = await verifyPlatformBootstrap(ctx.pool);
    if (!report.ok) {
      throw new Error(`Queue prerequisites failed: ${report.failures.join('; ')}`);
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

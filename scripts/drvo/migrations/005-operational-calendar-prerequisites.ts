import { sha256Hex } from '../checksum';
import { verifyPlatformBootstrap } from '../platformBootstrap';
import type { DrvoMigrationDefinition } from '../types';

export const operationalCalendarPrerequisitesMigration: DrvoMigrationDefinition = {
  migrationId: 5,
  migrationKey: 'operational-calendar-prerequisites',
  name: 'DRVO-006 Operational calendar prerequisites',
  dependencies: ['platform-bootstrap'],
  checksum: sha256Hex('operational-calendar-prerequisites-v1'),
  control: {
    kind: 'verification',
    risk: 'LOW',
    requiresBackup: false,
    lockProfile: 'none',
    rollbackStrategy: 'No schema/data mutation; no rollback required.',
  },
  async apply(ctx) {
    const report = await verifyPlatformBootstrap(ctx.pool);
    if (!report.ok) {
      throw new Error(
        `Operational calendar prerequisites failed: ${report.failures.join('; ')}`,
      );
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

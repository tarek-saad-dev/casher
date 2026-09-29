import { sha256Hex } from '../checksum';
import { verifyPlatformBootstrap } from '../platformBootstrap';
import type { DrvoMigrationDefinition } from '../types';

export const posPrerequisitesMigration: DrvoMigrationDefinition = {
  migrationId: 8,
  migrationKey: 'pos-prerequisites',
  name: 'DRVO-008 POS / sales prerequisites',
  dependencies: ['platform-bootstrap', 'treasury-movement-registry'],
  checksum: sha256Hex('pos-prerequisites-v1'),
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
      throw new Error(`POS prerequisites failed: ${report.failures.join('; ')}`);
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

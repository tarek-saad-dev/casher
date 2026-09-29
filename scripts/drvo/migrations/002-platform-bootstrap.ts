import { sha256Hex } from '../checksum';
import {
  ensurePlatformBootstrapData,
  verifyPlatformBootstrap,
} from '../platformBootstrap';
import type { DrvoMigrationDefinition } from '../types';

export const platformBootstrapMigration: DrvoMigrationDefinition = {
  migrationId: 2,
  migrationKey: 'platform-bootstrap',
  name: 'DRVO-003 Platform bootstrap tenant and mappings',
  dependencies: ['platform-core'],
  checksum: sha256Hex('platform-bootstrap-v2'),
  control: {
    kind: 'data',
    risk: 'MEDIUM',
    requiresBackup: true,
    lockProfile: 'short',
    rollbackStrategy: 'Restore the approved pre-migration backup or reverse only the bootstrap tenant/mapping rows after reconciliation.',
  },
  async apply(ctx) {
    await ensurePlatformBootstrapData(ctx.pool);
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

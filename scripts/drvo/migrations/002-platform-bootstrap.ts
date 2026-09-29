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

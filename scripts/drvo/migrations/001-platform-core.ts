import path from 'path';
import { checksumFile } from '../checksum';
import { executeSqlFile } from '../sqlBatch';
import { verifyPlatformCoreStructure } from '../platformCoreSchema';
import type { DrvoMigrationDefinition } from '../types';

const SCHEMA = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'db',
  'drvo-migrations',
  '001-platform-core',
  'schema.sql',
);

export const platformCoreMigration: DrvoMigrationDefinition = {
  migrationId: 1,
  migrationKey: 'platform-core',
  name: 'DRVO-003 Platform Core schema',
  dependencies: [],
  checksum: checksumFile(SCHEMA),
  async apply(ctx) {
    await executeSqlFile(ctx.pool, SCHEMA);
  },
  async verify(ctx) {
    const report = await verifyPlatformCoreStructure(ctx.pool);
    return {
      ok: report.ok,
      failures: report.failures,
    };
  },
  async reconcileBaseline(ctx) {
    const report = await verifyPlatformCoreStructure(ctx.pool);
    return report.ok;
  },
};

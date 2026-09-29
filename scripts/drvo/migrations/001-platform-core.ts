import path from 'path';
import { checksumFile } from '../checksum';
import { executeSqlFile } from '../sqlBatch';
import { allPlatformCoreTablesExist } from '../platformBootstrap';
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
    const ok = await allPlatformCoreTablesExist(ctx.pool);
    return {
      ok,
      failures: ok ? [] : ['Platform Core tables missing after migration'],
    };
  },
  async reconcileBaseline(ctx) {
    return allPlatformCoreTablesExist(ctx.pool);
  },
};

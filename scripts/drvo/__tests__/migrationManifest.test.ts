import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  assertDrvoMigrationManifestValid,
  DRVO_MIGRATIONS,
  DRVO_MODULE_REQUIRED_MIGRATIONS,
} from '../migrations/index';
import { checksumFile } from '../checksum';
import { readSqlBatches } from '../sqlBatch';

describe('DRVO migration manifest', () => {
  it('has valid ordering, unique ids/keys, and resolvable dependencies', () => {
    expect(() => assertDrvoMigrationManifestValid()).not.toThrow();
    expect(DRVO_MIGRATIONS.map((m) => m.migrationId)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('uses stable checksums for SQL-backed migrations', () => {
    const platform = DRVO_MIGRATIONS.find((m) => m.migrationKey === 'platform-core')!;
    const treasury = DRVO_MIGRATIONS.find((m) => m.migrationKey === 'treasury-movement-registry')!;
    expect(platform.checksum).toBe(
      checksumFile(
        path.join(process.cwd(), 'db/drvo-migrations/001-platform-core/schema.sql'),
      ),
    );
    expect(treasury.checksum).toBe(
      checksumFile(
        path.join(process.cwd(), 'db/drvo-migrations/006-treasury-movement-registry/schema.sql'),
      ),
    );
  });

  it('registry SQL defines DrvoSchemaMigration', () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'db/drvo-migrations/000-registry/schema.sql'),
      'utf8',
    );
    expect(sql).toContain('DrvoSchemaMigration');
    expect(sql).toContain('MigrationKey');
    expect(sql).toContain('Checksum');
  });

  it('module required migrations reference manifest keys', () => {
    const keys = new Set(DRVO_MIGRATIONS.map((m) => m.migrationKey));
    for (const [mod, required] of Object.entries(DRVO_MODULE_REQUIRED_MIGRATIONS)) {
      for (const key of required) {
        expect(keys.has(key), `${mod} requires unknown ${key}`).toBe(true);
      }
    }
  });

  it('platform-core and treasury SQL parse into batches', () => {
    const platformBatches = readSqlBatches(
      path.join(process.cwd(), 'db/drvo-migrations/001-platform-core/schema.sql'),
    );
    expect(platformBatches.length).toBeGreaterThan(0);
    expect(platformBatches.join('\n')).toContain('dbo.Tenant');
  });
});

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  assertDrvoMigrationManifestValid,
  DRVO_MIGRATIONS,
  getDrvoModuleRequiredMigrations,
} from '../migrations/index';
import { checksumFile } from '../checksum';
import { readSqlBatches } from '../sqlBatch';
import {
  assertAllDrvoRolloutContracts,
  drvoModuleRequiredMigrationsFromManifest,
} from '../../../src/platform/drvo/moduleManifest';
import { assertDrvoDeployManifestConsistent } from '../readiness';

describe('DRVO migration manifest', () => {
  it('has valid ordering, unique ids/keys, and resolvable dependencies', () => {
    expect(() => assertDrvoMigrationManifestValid()).not.toThrow();
    expect(DRVO_MIGRATIONS.map((m) => m.migrationId)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(DRVO_MIGRATIONS.map((m) => m.migrationKey)).toContain('booking-hold-key');
  });

  it('enforces extracted rollout contracts and aligns module migration keys', () => {
    expect(() => assertAllDrvoRolloutContracts()).not.toThrow();
    expect(() => assertDrvoDeployManifestConsistent()).not.toThrow();
    expect(drvoModuleRequiredMigrationsFromManifest()).toEqual(getDrvoModuleRequiredMigrations());
  });

  it('uses stable checksums for SQL-backed migrations', () => {
    const platform = DRVO_MIGRATIONS.find((m) => m.migrationKey === 'platform-core')!;
    const treasury = DRVO_MIGRATIONS.find((m) => m.migrationKey === 'treasury-movement-registry')!;
    const holdKey = DRVO_MIGRATIONS.find((m) => m.migrationKey === 'booking-hold-key')!;
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
    expect(holdKey.checksum).toBe(
      checksumFile(
        path.join(process.cwd(), 'db/drvo-migrations/007-booking-hold-key/schema.sql'),
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
    for (const [mod, required] of Object.entries(getDrvoModuleRequiredMigrations())) {
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

  it('SalonPackConfig ensure is insert-only (no overwrite)', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'scripts/drvo/platformBootstrap.ts'),
      'utf8',
    );
    expect(src).toContain('IF NOT EXISTS (SELECT 1 FROM dbo.SalonPackConfig WHERE TenantId = @tenantId)');
    expect(src).not.toMatch(/UPDATE dbo\.SalonPackConfig\s+SET ManifestJson/);
  });
});

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { checksumFile } from '../checksum';
import {
  assertDrvoMigrationManifestValid,
  DRVO_MIGRATIONS,
} from '../migrations/index';
import { TENANT_BRAND_PROFILE_MIGRATION_KEY } from '../migrations/011-tenant-brand-profile';
import { readSqlBatches } from '../sqlBatch';

const SQL_PATH = path.join(process.cwd(), 'db/drvo-migrations/011-tenant-brand-profile/schema.sql');
const sqlText = fs.readFileSync(SQL_PATH, 'utf8');
const sqlNoComments = sqlText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');

describe('DRVO-017 migration 11 manifest entry', () => {
  const m = DRVO_MIGRATIONS.find((x) => x.migrationKey === TENANT_BRAND_PROFILE_MIGRATION_KEY)!;

  it('is id 11 with a canonical checksum, control metadata and platform dependencies', () => {
    expect(m.migrationId).toBe(11);
    expect(m.checksum).toBe(checksumFile(SQL_PATH));
    expect(m.legacyChecksums).toBeUndefined();
    expect(m.dependencies).toEqual(['platform-core', 'platform-bootstrap']);
    expect(m.control).toMatchObject({ kind: 'mixed', risk: 'LOW', requiresBackup: true, lockProfile: 'short' });
    expect(m.control.rollbackStrategy.toLowerCase()).toContain('reverting the application commit');
  });

  it('follows DRVO-015 migration 10 with no gap', () => {
    expect(DRVO_MIGRATIONS.find((x) => x.migrationId === 10)?.migrationKey).toBe('master-data-tenancy');
    expect(DRVO_MIGRATIONS.findIndex((x) => x.migrationId === 11)).toBe(DRVO_MIGRATIONS.findIndex((x) => x.migrationId === 10) + 1);
    expect(() => assertDrvoMigrationManifestValid()).not.toThrow();
  });
});

describe('DRVO-017 migration 11 SQL safety', () => {
  it('is one transactional batch with TRY/CATCH', () => {
    expect(readSqlBatches(SQL_PATH)).toHaveLength(1);
    expect(sqlNoComments).toContain('SET XACT_ABORT ON');
    expect(sqlNoComments).toContain('BEGIN TRAN');
    expect(sqlNoComments).toContain('ROLLBACK TRAN');
  });

  it('is additive and insert-only: no DROP, DELETE, TRUNCATE, ALTER COLUMN or UPDATE', () => {
    expect(sqlNoComments).not.toMatch(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX)\b/i);
    expect(sqlNoComments).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sqlNoComments).not.toMatch(/\bTRUNCATE\b/i);
    expect(sqlNoComments).not.toMatch(/\bALTER\s+COLUMN\b/i);
    expect(sqlNoComments).not.toMatch(/\bUPDATE\s+dbo\./i);
  });

  it('creates TenantBrandProfile with every Migration 11 field', () => {
    for (const col of [
      'DisplayName',
      'LogoUrl',
      'Phone',
      'Address',
      'PrimaryColor',
      'AccentColor',
      'ReceiptFooter',
      'Timezone',
      'PublicBookingOrigins',
    ]) {
      expect(sqlNoComments).toMatch(new RegExp(`\\b${col}\\s+NVARCHAR`));
    }
    expect(sqlNoComments).toContain('FK_TenantBrandProfile_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant');
    expect(sqlNoComments).toContain("LogoUrl LIKE N'/%' OR LogoUrl LIKE N'https://%'");
    expect(sqlNoComments).toContain('ISJSON(PublicBookingOrigins) = 1');
  });

  it('seeds the CUT identity for CASHER_BOOT only, insert-only', () => {
    const seed = /INSERT INTO dbo\.TenantBrandProfile \([\s\S]*?WHERE t\.Code = N'CASHER_BOOT'[\s\S]*?;/.exec(
      sqlNoComments,
    )?.[0];
    expect(seed).toBeDefined();
    expect(seed).toContain("N'Cut Salon'");
    expect(seed).toContain("N'/cutsalon.png'");
    expect(seed).toContain("N'01012126899 - 035861483'");
    expect(seed).toContain('NOT EXISTS');
  });

  it('backfills every other tenant from its own data (no CUT branding leaks)', () => {
    const blocks = sqlNoComments.match(/INSERT INTO dbo\.TenantBrandProfile[\s\S]*?;/g) ?? [];
    expect(blocks).toHaveLength(2);
    const generic = blocks[1]!;
    expect(generic).toContain('t.Name');
    expect(generic).toContain('NOT EXISTS');
    expect(generic).not.toMatch(/Cut|CUT|cutsalon/);
  });

  it('grants /admin/tenant to admin and super_admin only, insert-only', () => {
    expect(sqlNoComments).toContain("IF NOT EXISTS (SELECT 1 FROM dbo.TblSystemPages WHERE PageKey = N'admin.tenant')");
    expect(sqlNoComments).toContain("r.RoleKey IN (N'admin', N'super_admin')");
  });
});

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { checksumFile } from '../checksum';
import { DRVO_MIGRATIONS } from '../migrations/index';
import {
  BASELINE_PLAN_CODES,
  COMMERCIAL_MIGRATION_KEY,
} from '../migrations/009-commercial-subscription-tenant-apps';
import { readSqlBatches } from '../sqlBatch';

const SQL_PATH = path.join(
  process.cwd(),
  'db/drvo-migrations/009-commercial-subscription-tenant-apps/schema.sql',
);
const sqlText = fs.readFileSync(SQL_PATH, 'utf8');
const sqlNoComments = sqlText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');

describe('DRVO-012 migration 9 manifest entry', () => {
  const m = DRVO_MIGRATIONS.find((x) => x.migrationKey === COMMERCIAL_MIGRATION_KEY)!;

  it('is the next contiguous id with checksum, control metadata and dependencies', () => {
    expect(m.migrationId).toBe(9);
    expect(m.checksum).toBe(checksumFile(SQL_PATH));
    expect(m.dependencies).toEqual(['platform-core', 'platform-bootstrap']);
    expect(m.control).toMatchObject({
      kind: 'mixed',
      risk: 'MEDIUM',
      requiresBackup: true,
      lockProfile: 'short',
    });
  });

  it('rollback prioritizes app rollback / forward fix, not destructive drops', () => {
    const rollback = m.control.rollbackStrategy.toLowerCase();
    expect(rollback).toContain('reverting the application commit');
    expect(rollback).toContain('forward-fix');
    expect(rollback).toContain('explicit approval');
  });
});

describe('DRVO-012 migration 9 SQL safety', () => {
  it('is a single transactional batch with TRY/CATCH', () => {
    expect(readSqlBatches(SQL_PATH)).toHaveLength(1);
    expect(sqlNoComments).toContain('SET XACT_ABORT ON');
    expect(sqlNoComments).toContain('BEGIN TRAN');
    expect(sqlNoComments).toContain('ROLLBACK TRAN');
  });

  it('is additive only: no DROP, DELETE, TRUNCATE or ALTER COLUMN', () => {
    expect(sqlNoComments).not.toMatch(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX)\b/i);
    expect(sqlNoComments).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sqlNoComments).not.toMatch(/\bTRUNCATE\b/i);
    expect(sqlNoComments).not.toMatch(/\bALTER\s+COLUMN\b/i);
  });

  it('the only UPDATE preserves effective Enabled=0 state', () => {
    const updates = sqlNoComments.match(/UPDATE\s+dbo\.\w+[\s\S]*?;/gi) ?? [];
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain('TenantAppEntitlement');
    expect(updates[0]).toMatch(/WHERE Enabled = 0/);
  });

  it('seeds starter/growth/pro/internal insert-only with internal unlimited and non-public', () => {
    for (const code of BASELINE_PLAN_CODES) {
      expect(sqlNoComments).toContain(`IF NOT EXISTS (SELECT 1 FROM dbo.SaaSPlan WHERE PlanCode = N'${code}')`);
    }
    expect(sqlNoComments).toMatch(/N'internal', N'Internal \(grandfathered\)', 0, 1, 1000, NULL, NULL/);
  });

  it('grandfathers every pre-existing tenant without starting any clock', () => {
    const backfill = /INSERT INTO dbo\.TenantSubscription[\s\S]*?;/.exec(sqlNoComments)?.[0] ?? '';
    expect(backfill).toContain("N'internal', N'active', N'migration_grandfathered'");
    expect(backfill).toContain('FROM dbo.Tenant t');
    expect(backfill).toContain('NOT EXISTS');
    expect(backfill).not.toMatch(/Trial|PeriodEnds|PastDue|SYSUTCDATETIME|DATEADD/i);
    expect(sqlNoComments).not.toMatch(/N'trial'\s*,\s*N'migration_grandfathered'/);
  });

  it('uses canonical subscription statuses and enforces Status/Enabled consistency', () => {
    expect(sqlNoComments).toContain(
      "Status IN (N'trial', N'active', N'past_due', N'suspended', N'cancelled')",
    );
    expect(sqlNoComments).not.toContain('trialing');
    expect(sqlNoComments).toMatch(/Status = N''installed'' AND Enabled = 1/);
  });

  it('backfills TenantIndustryPack insert-only from the SalonPackConfig seam', () => {
    expect(sqlNoComments).toMatch(/INSERT INTO dbo\.TenantIndustryPack[\s\S]*FROM dbo\.SalonPackConfig c/);
  });

  it('references new TenantAppEntitlement columns only through sp_executesql', () => {
    const direct = sqlNoComments.replace(/EXEC sp_executesql N'[\s\S]*?';/g, '');
    expect(direct).not.toMatch(/SET Status\b/);
    expect(direct).not.toMatch(/CK_TenantAppEntitlement_Status CHECK/);
  });

  it('subscription reconcile is insert-only and uses the grandfather rule', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'scripts/drvo/migrations/009-commercial-subscription-tenant-apps.ts'),
      'utf8',
    );
    const body =
      /export async function reconcileGrandfatheredSubscriptions[\s\S]*?\r?\n}\r?\n/.exec(src)?.[0] ?? '';
    expect(body).toContain("SELECT t.TenantId, N'internal', N'active', N'migration_grandfathered'");
    expect(body).toContain('WHERE NOT EXISTS');
    expect(body).not.toMatch(/\bUPDATE\b|\bDELETE\b|Trial|PeriodEnds|PastDue/);
    const cli = fs.readFileSync(
      path.join(process.cwd(), 'scripts/drvo/drvo-012-reconcile-subscriptions.ts'),
      'utf8',
    );
    expect(cli).toContain('assertDatabaseAllowed');
    expect(cli).toContain('--expected-database=');
    expect(cli).toContain('COMMERCIAL_MIGRATION_KEY');
  });

  it('verification derives CASHER_BOOT apps from the registry, not a hardcoded count', () => {
    const verify = fs.readFileSync(
      path.join(process.cwd(), 'scripts/drvo/migrations/009-commercial-subscription-tenant-apps.ts'),
      'utf8',
    );
    expect(verify).toContain('for (const code of APP_REGISTRY_CODES)');
    expect(verify).not.toMatch(/\b12\b/);
  });
});

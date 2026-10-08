import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { checksumFile } from '../checksum';
import { DRVO_MIGRATIONS } from '../migrations/index';
import {
  MASTER_DATA_MIGRATION_KEY,
  MASTER_DATA_REQUIRED_INDEXES,
  MASTER_DATA_TENANT_UNIQUES,
  verifyMasterDataTenancySchema,
  verifyNoNullMasterDataTenant,
} from '../migrations/010-master-data-tenancy';
import { readSqlBatches } from '../sqlBatch';
import { MASTER_DATA_TENANT_TABLES } from '../../../src/platform/masterData/tables';

const SQL_PATH = path.join(process.cwd(), 'db/drvo-migrations/010-master-data-tenancy/schema.sql');
const sqlText = fs.readFileSync(SQL_PATH, 'utf8');
const sqlNoComments = sqlText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');

describe('DRVO-015 migration 10 manifest entry', () => {
  const m = DRVO_MIGRATIONS.find((x) => x.migrationKey === MASTER_DATA_MIGRATION_KEY)!;

  it('is the next contiguous id with one canonical checksum and control metadata', () => {
    expect(m.migrationId).toBe(10);
    expect(DRVO_MIGRATIONS[DRVO_MIGRATIONS.indexOf(m) - 1]?.migrationId).toBe(9);
    expect(m.checksum).toBe(checksumFile(SQL_PATH));
    expect(m.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(m.legacyChecksums).toBeUndefined();
    expect(m.dependencies).toEqual(['platform-core', 'platform-bootstrap']);
    expect(m.control).toMatchObject({ kind: 'mixed', risk: 'HIGH', requiresBackup: true, lockProfile: 'short' });
  });

  it('rollback is forward-fix with explicit approval for anything destructive', () => {
    const rollback = m.control.rollbackStrategy.toLowerCase();
    expect(rollback).toContain('forward-fix');
    expect(rollback).toContain('explicit approval');
    expect(rollback).toContain('backup');
  });

  it('the checksum is line-ending independent (LF canonical)', () => {
    const crlf = path.join(process.cwd(), 'tmp-drvo015-crlf.sql');
    fs.writeFileSync(crlf, sqlText.replace(/\r?\n/g, '\r\n'));
    try {
      expect(checksumFile(crlf)).toBe(m.checksum);
    } finally {
      fs.unlinkSync(crlf);
    }
  });
});

describe('DRVO-015 migration 10 SQL safety', () => {
  it('is a single transactional batch with TRY/CATCH', () => {
    expect(readSqlBatches(SQL_PATH)).toHaveLength(1);
    expect(sqlNoComments).toContain('SET XACT_ABORT ON');
    expect(sqlNoComments).toContain('BEGIN TRAN');
    expect(sqlNoComments).toContain('ROLLBACK TRAN');
  });

  it('is additive: no DROP, DELETE or TRUNCATE; ALTER COLUMN only tightens the new TenantId', () => {
    expect(sqlNoComments).not.toMatch(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX)\b/i);
    expect(sqlNoComments).not.toMatch(/\bDELETE\s+(FROM\s+)?dbo\./i);
    expect(sqlNoComments).not.toMatch(/\bTRUNCATE\b/i);
    const alters = sqlNoComments.match(/ALTER\s+COLUMN\s+\w+[^;']*/gi) ?? [];
    expect(alters).toHaveLength(MASTER_DATA_TENANT_TABLES.length);
    for (const a of alters) expect(a).toMatch(/^ALTER COLUMN TenantId UNIQUEIDENTIFIER NOT NULL/i);
  });

  it('every UPDATE only fills a NULL TenantId (never reassigns, never touches business columns)', () => {
    const updates = sqlNoComments.match(/UPDATE\s+[\s\S]*?WHERE[^;]*;/gi) ?? [];
    expect(updates.length).toBeGreaterThanOrEqual(8);
    for (const u of updates) {
      expect(u).toMatch(/SET\s+(\w+\.)?TenantId\s*=/i);
      expect(u).toMatch(/TenantId IS NULL/i);
    }
  });

  it('requires exactly one CASHER_BOOT tenant and refuses ambiguous employees', () => {
    expect(sqlNoComments).toMatch(/Code = N'CASHER_BOOT'\) <> 1\s+THROW 51015/);
    expect(sqlNoComments).toMatch(/HAVING COUNT\(DISTINCT l\.TenantId\) > 1\s*\)\s+THROW 51016/);
  });

  it('gates NOT NULL on a zero NULL-count across all tables', () => {
    const gate = sqlNoComments.indexOf('THROW 51017');
    const firstNotNull = sqlNoComments.search(/ALTER COLUMN TenantId UNIQUEIDENTIFIER NOT NULL/);
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(firstNotNull);
    for (const t of MASTER_DATA_TENANT_TABLES) {
      expect(sqlNoComments).toContain(`(SELECT COUNT(*) FROM dbo.${t} WHERE TenantId IS NULL)`);
    }
  });

  it('adds TenantId, a trusted Tenant FK and a (TenantId, id) unique to every owned table', () => {
    for (const t of MASTER_DATA_TENANT_TABLES) {
      expect(sqlNoComments).toContain(`ALTER TABLE dbo.${t} ADD TenantId UNIQUEIDENTIFIER NULL`);
      expect(sqlNoComments).toContain(
        `ALTER TABLE dbo.${t} WITH CHECK ADD CONSTRAINT FK_${t}_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId)`,
      );
      expect(sqlNoComments).toContain(`CREATE UNIQUE INDEX ${MASTER_DATA_TENANT_UNIQUES[t]} ON dbo.${t} (TenantId,`);
    }
    for (const { table, name } of MASTER_DATA_REQUIRED_INDEXES) {
      expect(sqlNoComments).toContain(`CREATE INDEX ${name} ON dbo.${table} (TenantId`);
    }
    expect(sqlNoComments).toContain('FOREIGN KEY (TenantId, PackageID) REFERENCES dbo.TblServicePackage (TenantId, PackageID)');
  });

  it('adds no natural-key unique, so two tenants may hold same-named rows', () => {
    expect(sqlNoComments).not.toMatch(/UNIQUE[^;]*\((?:TenantId,\s*)?(Name|ProName|CatName|Mobile|PaymentMethod|NameEn)\b/i);
  });

  it('has no DEFAULT on TenantId (unscoped inserts fail closed instead of landing in a tenant)', () => {
    expect(sqlNoComments).not.toMatch(/TenantId[^;,]*DEFAULT/i);
  });
});

function fakePool(answer: (text: string, params: Record<string, unknown>) => Record<string, unknown>[]): ConnectionPool {
  return {
    request() {
      const params: Record<string, unknown> = {};
      const r = {
        input(name: string, ...rest: unknown[]) {
          params[name] = rest.length > 1 ? rest[1] : rest[0];
          return r;
        },
        async query(text: string) {
          return { recordset: answer(text.replace(/\s+/g, ' '), params) };
        },
      };
      return r;
    },
  } as unknown as ConnectionPool;
}

describe('DRVO-015 null TenantId verification', () => {
  it('reports ok when every table has zero NULL TenantId', async () => {
    const pool = fakePool((t) => (/COL_LENGTH/.test(t) ? [{ ok: 1 }] : [{ n: 0 }]));
    const report = await verifyNoNullMasterDataTenant(pool);
    expect(report.ok).toBe(true);
    expect(Object.keys(report.nullCounts).sort()).toEqual([...MASTER_DATA_TENANT_TABLES].sort());
  });

  it('flags tables with NULL TenantId and tables missing the column', async () => {
    const pool = fakePool((t, p) => {
      if (/COL_LENGTH/.test(t)) return [{ ok: p.name === 'dbo.TblEmp' ? 0 : 1 }];
      return [{ n: /FROM dbo\.TblClient /.test(t) ? 3 : 0 }];
    });
    const report = await verifyNoNullMasterDataTenant(pool);
    expect(report.ok).toBe(false);
    expect(report.nullCounts.TblClient).toBe(3);
    expect(report.nullCounts.TblEmp).toBe(-1);
  });
});

describe('DRVO-015 schema verification', () => {
  const healthy = (overrides: (t: string, p: Record<string, unknown>) => Record<string, unknown>[] | null = () => null) =>
    fakePool((t, p) => {
      const o = overrides(t, p);
      if (o) return o;
      if (/FROM sys\.columns c JOIN sys\.types/.test(t)) return [{ is_nullable: 0, typeName: 'uniqueidentifier' }];
      if (/COL_LENGTH/.test(t)) return [{ ok: 1 }];
      if (/CASHER_BOOT/.test(t)) return [{ bootTenants: 1 }];
      if (/COUNT_BIG/.test(t)) return [{ n: 0 }];
      return [{ ok: 1 }];
    });

  it('passes on a fully migrated schema', async () => {
    await expect(verifyMasterDataTenancySchema(healthy())).resolves.toEqual({ ok: true, failures: [] });
  });

  it('fails when a TenantId column is still nullable', async () => {
    const r = await verifyMasterDataTenancySchema(
      healthy((t, p) => (/FROM sys\.columns c JOIN sys\.types/.test(t) && p.table === 'TblPro' ? [{ is_nullable: 1, typeName: 'uniqueidentifier' }] : null)),
    );
    expect(r.ok).toBe(false);
    expect(r.failures).toContain('dbo.TblPro.TenantId must be NOT NULL');
  });

  it('fails when a package item points at another tenant service', async () => {
    const r = await verifyMasterDataTenancySchema(
      healthy((t) => (/JOIN dbo\.TblPro p WITH \(NOLOCK\) ON p\.ProID = i\.ProID/.test(t) ? [{ n: 2 }] : null)),
    );
    expect(r.ok).toBe(false);
    expect(r.failures).toContain('2 package item(s) reference a service of another tenant');
  });

  it('fails when CASHER_BOOT is missing', async () => {
    const r = await verifyMasterDataTenancySchema(healthy((t) => (/CASHER_BOOT/.test(t) ? [{ bootTenants: 0 }] : null)));
    expect(r.failures).toContain('CASHER_BOOT tenant missing');
  });
});

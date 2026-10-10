import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { checksumFile } from '../checksum';
import { DRVO_MIGRATIONS } from '../migrations/index';
import {
  MESSAGING_TENANCY_MIGRATION_KEY,
  MESSAGING_TENANT_SCOPED_TABLES,
  MESSAGING_TENANT_UNIQUE_REPLACEMENTS,
  messagingTenancyMigration,
} from '../migrations/012-messaging-tenancy';
import { readSqlBatches } from '../sqlBatch';

const SQL_PATH = path.join(process.cwd(), 'db/drvo-migrations/012-messaging-tenancy/schema.sql');
const sqlText = fs.readFileSync(SQL_PATH, 'utf8');
const sqlNoComments = sqlText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');

function createTableBlock(table: string): string {
  return new RegExp(`CREATE TABLE dbo\\.${table} \\([\\s\\S]*?\\n    \\);`).exec(sqlNoComments)?.[0] ?? '';
}

describe('DRVO-018 migration 12 manifest entry', () => {
  const m = DRVO_MIGRATIONS.find((x) => x.migrationKey === MESSAGING_TENANCY_MIGRATION_KEY)!;

  it('is registered as id 12 with key messaging-tenancy, checksum and dependencies', () => {
    expect(m).toBeDefined();
    expect(m).toBe(messagingTenancyMigration);
    expect(m.migrationId).toBe(12);
    expect(m.migrationKey).toBe('messaging-tenancy');
    expect(m.dependencies).toEqual(['platform-core', 'platform-bootstrap']);
    expect(m.control).toMatchObject({ kind: 'mixed', risk: 'HIGH', requiresBackup: true });
  });

  it('checksum is the stable checksum of schema.sql', () => {
    expect(m.checksum).toBe(checksumFile(SQL_PATH));
    expect(checksumFile(SQL_PATH)).toBe(checksumFile(SQL_PATH));
    expect(m.checksum).toMatch(/^[0-9a-f]{64}$/i);
  });

  it('rollback is app rollback / forward fix, not destructive drops', () => {
    const rollback = m.control.rollbackStrategy.toLowerCase();
    expect(rollback).toContain('reverting the application commit');
    expect(rollback).toContain('forward-fix');
    expect(rollback).toContain('explicit approval');
  });
});

describe('DRVO-018 migration 12 SQL', () => {
  it('is a single transactional batch with TRY/CATCH', () => {
    expect(readSqlBatches(SQL_PATH)).toHaveLength(1);
    expect(sqlNoComments).toContain('SET XACT_ABORT ON');
    expect(sqlNoComments).toContain('BEGIN TRAN');
    expect(sqlNoComments).toContain('COMMIT TRAN');
    expect(sqlNoComments).toContain('ROLLBACK TRAN');
  });

  it('never drops tables/columns, deletes or truncates data', () => {
    expect(sqlNoComments).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
    expect(sqlNoComments).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sqlNoComments).not.toMatch(/\bTRUNCATE\b/i);
    expect(sqlNoComments).not.toMatch(/\bALTER\s+COLUMN\b/i);
  });

  it('creates TenantMessagingChannel with tenant FK, status checks and hashed token', () => {
    const block = createTableBlock('TenantMessagingChannel');
    expect(block).not.toBe('');
    expect(block).toContain('TenantId UNIQUEIDENTIFIER NOT NULL');
    expect(block).toContain('WebhookTokenHash CHAR(64) NULL');
    expect(block).toContain('CONSTRAINT PK_TenantMessagingChannel PRIMARY KEY (ChannelId)');
    expect(block).toContain('FK_TenantMessagingChannel_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId)');
    expect(block).toContain("CK_TenantMessagingChannel_Status CHECK (Status IN (N'pending', N'active', N'disabled'))");
    expect(block).toMatch(/CK_TenantMessagingChannel_Active CHECK \(\s*Status <> N'active' OR \(EndpointUrl IS NOT NULL AND WebhookTokenHash IS NOT NULL\)/);
    expect(block).toContain('CK_TenantMessagingChannel_TokenHash');
    expect(block).not.toMatch(/WebhookToken\s+NVARCHAR/i);
    expect(sqlNoComments).toMatch(
      /CREATE UNIQUE INDEX UX_TenantMessagingChannel_TokenHash\s+ON dbo\.TenantMessagingChannel \(WebhookTokenHash\) WHERE WebhookTokenHash IS NOT NULL/,
    );
    expect(sqlNoComments).toMatch(
      /CREATE UNIQUE INDEX UX_TenantMessagingChannel_ActivePerTenant\s+ON dbo\.TenantMessagingChannel \(TenantId, Channel\) WHERE Status = N'active'/,
    );
  });

  it('creates TenantAiConfig keyed by tenant', () => {
    const block = createTableBlock('TenantAiConfig');
    expect(block).not.toBe('');
    expect(block).toContain('CONSTRAINT PK_TenantAiConfig PRIMARY KEY (TenantId)');
    expect(block).toContain('FK_TenantAiConfig_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId)');
    for (const col of ['BusinessName', 'AssistantPersona', 'BusinessHoursJson', 'PoliciesJson', 'BookingActorUserId', 'ConversationPack', 'Revision']) {
      expect(block).toContain(col);
    }
  });

  it('creates TenantMessagingUsage with tenant-leading key', () => {
    const block = createTableBlock('TenantMessagingUsage');
    expect(block).not.toBe('');
    expect(block).toContain('CONSTRAINT PK_TenantMessagingUsage PRIMARY KEY (TenantId, UsageDate, Channel, Metric)');
    expect(block).toContain('FK_TenantMessagingUsage_Tenant FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId)');
  });

  it('new tables are created only when absent (idempotent)', () => {
    for (const t of ['TenantMessagingChannel', 'TenantAiConfig', 'TenantMessagingUsage']) {
      expect(sqlNoComments).toContain(`IF OBJECT_ID(N'dbo.${t}', N'U') IS NULL`);
    }
  });

  it('adds nullable TenantId + tenant FK + index to exactly MESSAGING_TENANT_SCOPED_TABLES', () => {
    const list = /INSERT INTO @tables \(Name\) VALUES([\s\S]*?);/.exec(sqlNoComments)?.[1] ?? '';
    const sqlTables = [...list.matchAll(/N'(\w+)'/g)].map((x) => x[1]);
    expect([...sqlTables].sort()).toEqual([...MESSAGING_TENANT_SCOPED_TABLES].sort());
    expect(sqlNoComments).toContain("N' ADD TenantId UNIQUEIDENTIFIER NULL;'");
    expect(sqlNoComments).toContain("N'FK_' + @name + N'_Tenant'");
    expect(sqlNoComments).toContain("N' FOREIGN KEY (TenantId) REFERENCES dbo.Tenant (TenantId);'");
    expect(sqlNoComments).toContain("N'IX_' + @name + N'_Tenant'");
  });

  it('backfills legacy rows to CASHER_BOOT only, failing if CASHER_BOOT is missing', () => {
    expect(sqlNoComments).toContain(
      "DECLARE @boot UNIQUEIDENTIFIER = (SELECT TenantId FROM dbo.Tenant WHERE Code = N'CASHER_BOOT');",
    );
    expect(sqlNoComments).toContain("N' SET TenantId = @boot WHERE TenantId IS NULL;'");
    expect(sqlNoComments).toMatch(/IF @boot IS NULL\s+THROW 51018/);
    const updates = sqlNoComments.match(/N'UPDATE dbo\.[\s\S]*?;'/g) ?? [];
    expect(updates).toHaveLength(1);
  });

  it('replaces every global unique with a tenant-leading unique index, creating it before dropping', () => {
    const block = /INSERT INTO @uniques[\s\S]*?VALUES([\s\S]*?);\s*\n/.exec(sqlNoComments)?.[1] ?? '';
    for (const [table, legacy, replacement] of MESSAGING_TENANT_UNIQUE_REPLACEMENTS) {
      const row = new RegExp(
        `\\(N'${table}', N'${legacy}', '[CI]',\\s*N'${replacement}', N'TenantId, [^']+'`,
      );
      expect(block, `${table} ${replacement}`).toMatch(row);
    }
    const rows = block.match(/\(N'Tbl\w+', N'\w+', '[CI]'/g) ?? [];
    expect(rows).toHaveLength(MESSAGING_TENANT_UNIQUE_REPLACEMENTS.length);

    const createAt = sqlNoComments.indexOf("N'CREATE UNIQUE INDEX ' + QUOTENAME(@new)");
    const dropConstraintAt = sqlNoComments.indexOf("N' DROP CONSTRAINT ' + QUOTENAME(@legacy)");
    const dropIndexAt = sqlNoComments.indexOf("N'DROP INDEX ' + QUOTENAME(@legacy)");
    expect(createAt).toBeGreaterThan(0);
    expect(dropConstraintAt).toBeGreaterThan(createAt);
    expect(dropIndexAt).toBeGreaterThan(createAt);
  });

  it('seeds CASHER_BOOT AI config and a pending (inactive) channel insert-only', () => {
    expect(sqlNoComments).toContain('IF NOT EXISTS (SELECT 1 FROM dbo.TenantAiConfig WHERE TenantId = @boot)');
    expect(sqlNoComments).toMatch(/INSERT INTO dbo\.TenantAiConfig[\s\S]*?@boot, 1, N'salon'/);
    expect(sqlNoComments).toContain(
      "IF NOT EXISTS (SELECT 1 FROM dbo.TenantMessagingChannel WHERE TenantId = @boot AND Channel = N'whatsapp')",
    );
    expect(sqlNoComments).toContain(
      "VALUES (@boot, N'whatsapp', N'whatsapp-bridge', N'pending');",
    );
    expect(sqlNoComments).not.toMatch(/INSERT INTO dbo\.TenantMessagingChannel[\s\S]*?N'active'/);
  });
});

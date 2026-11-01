import path from 'path';
import type { ConnectionPool } from 'mssql';
import { checksumFile } from '../checksum';
import { executeSqlFile } from '../sqlBatch';
import type { DrvoMigrationDefinition } from '../types';

export const MARKETING_CONSENT_EVIDENCE_MIGRATION_KEY = 'marketing-consent-evidence' as const;

const SCHEMA = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'db',
  'drvo-migrations',
  '020-marketing-consent-evidence',
  'schema.sql',
);

export async function verifyMarketingConsentEvidenceSchema(
  pool: ConnectionPool,
): Promise<{ ok: boolean; failures: string[] }> {
  const failures: string[] = [];

  const table = await pool.request().query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.TblMarketingConsentEvidence', N'U') IS NULL THEN 0 ELSE 1 END AS ok;
  `);
  if (Number(table.recordset[0]?.ok) !== 1) {
    return { ok: false, failures: ['Missing TblMarketingConsentEvidence'] };
  }

  for (const column of [
    'ID',
    'TenantId',
    'ClientID',
    'PhoneE164',
    'Status',
    'EvidenceSource',
    'EvidenceRef',
    'GrantedAt',
    'RevokedAt',
    'Notes',
    'CreatedAt',
    'CreatedByUserID',
  ]) {
    const r = await pool.request().input('column', column).query(`
      SELECT CASE WHEN COL_LENGTH(N'dbo.TblMarketingConsentEvidence', @column) IS NULL THEN 0 ELSE 1 END AS ok;
    `);
    if (Number(r.recordset[0]?.ok) !== 1) {
      failures.push('Missing TblMarketingConsentEvidence.' + column);
    }
  }

  for (const index of [
    'IX_TblMarketingConsentEvidence_Tenant_Phone',
    'IX_TblMarketingConsentEvidence_Tenant_Client',
  ]) {
    const r = await pool.request().input('name', index).query(`
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'dbo.TblMarketingConsentEvidence')
          AND name = @name
          AND is_disabled = 0
      ) THEN 1 ELSE 0 END AS ok;
    `);
    if (Number(r.recordset[0]?.ok) !== 1) {
      failures.push('Missing index ' + index);
    }
  }

  const statusCk = await pool.request().query(`
    SELECT definition
    FROM sys.check_constraints
    WHERE name = N'CK_TblMarketingConsentEvidence_Status'
      AND parent_object_id = OBJECT_ID(N'dbo.TblMarketingConsentEvidence')
      AND is_disabled = 0;
  `);
  const statusDef = String(statusCk.recordset[0]?.definition ?? '');
  if (!/granted/i.test(statusDef) || !/revoked/i.test(statusDef)) {
    failures.push('Missing/invalid CK_TblMarketingConsentEvidence_Status');
  }

  const campaignExists = await pool.request().query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.TblWhatsAppCampaign', N'U') IS NULL THEN 0 ELSE 1 END AS ok;
  `);
  if (Number(campaignExists.recordset[0]?.ok) === 1) {
    const campaignCk = await pool.request().query(`
      SELECT definition
      FROM sys.check_constraints
      WHERE name = N'CK_TblWhatsAppCampaign_Status'
        AND parent_object_id = OBJECT_ID(N'dbo.TblWhatsAppCampaign')
        AND is_disabled = 0;
    `);
    const campaignDef = String(campaignCk.recordset[0]?.definition ?? '');
    if (!/paused/i.test(campaignDef)) {
      failures.push('CK_TblWhatsAppCampaign_Status does not allow paused');
    }
  }

  return { ok: failures.length === 0, failures };
}

export const marketingConsentEvidenceMigration: DrvoMigrationDefinition = {
  migrationId: 20,
  migrationKey: MARKETING_CONSENT_EVIDENCE_MIGRATION_KEY,
  name: 'Marketing consent evidence table and paused WhatsApp campaign status',
  dependencies: ['messaging-tenancy'],
  checksum: checksumFile(SCHEMA),
  control: {
    kind: 'schema',
    risk: 'MEDIUM',
    requiresBackup: true,
    lockProfile: 'short',
    rollbackStrategy:
      'Additive consent table plus campaign status CHECK widen. Revert application feature; retain evidence rows. Restoring the old campaign status CHECK requires explicit approval and must keep any paused rows remapped first.',
  },
  async apply(ctx) {
    await executeSqlFile(ctx.pool, SCHEMA);
  },
  async verify(ctx) {
    return verifyMarketingConsentEvidenceSchema(ctx.pool);
  },
  async reconcileBaseline(ctx) {
    return (await verifyMarketingConsentEvidenceSchema(ctx.pool)).ok;
  },
};

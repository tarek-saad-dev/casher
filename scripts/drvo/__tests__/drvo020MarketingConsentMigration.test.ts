import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { checksumFile } from '../checksum';
import { DRVO_MIGRATIONS } from '../migrations/index';
import {
  MARKETING_CONSENT_EVIDENCE_MIGRATION_KEY,
  marketingConsentEvidenceMigration,
} from '../migrations/020-marketing-consent-evidence';
import { readSqlBatches } from '../sqlBatch';

const SQL_PATH = path.join(
  process.cwd(),
  'db/drvo-migrations/020-marketing-consent-evidence/schema.sql',
);
const sqlText = fs.readFileSync(SQL_PATH, 'utf8');

describe('DRVO-020 marketing consent evidence migration', () => {
  const m = DRVO_MIGRATIONS.find((x) => x.migrationKey === MARKETING_CONSENT_EVIDENCE_MIGRATION_KEY)!;

  it('is registered as id 20 with checksum, dependencies, and control metadata', () => {
    expect(m).toBeDefined();
    expect(m).toBe(marketingConsentEvidenceMigration);
    expect(m.migrationId).toBe(20);
    expect(m.migrationKey).toBe('marketing-consent-evidence');
    expect(m.dependencies).toEqual(['messaging-tenancy']);
    expect(m.control).toMatchObject({
      kind: 'schema',
      risk: 'MEDIUM',
      requiresBackup: true,
      lockProfile: 'short',
    });
    expect(m.checksum).toBe(checksumFile(SQL_PATH));
    expect(m.checksum).toMatch(/^[0-9a-f]{64}$/i);
  });

  it('SQL creates consent evidence and widens campaign status to paused', () => {
    expect(readSqlBatches(SQL_PATH).length).toBeGreaterThanOrEqual(3);
    expect(sqlText).toContain('TblMarketingConsentEvidence');
    expect(sqlText).toContain('CK_TblMarketingConsentEvidence_Status');
    expect(sqlText).toMatch(/paused/i);
    expect(sqlText).not.toMatch(/\bINSERT\s+INTO\s+dbo\.TblMarketingConsentEvidence\b/i);
    expect(sqlText).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sqlText).not.toMatch(/\bTRUNCATE\b/i);
  });
});

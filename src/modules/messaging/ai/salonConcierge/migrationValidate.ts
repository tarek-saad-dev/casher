/** Structural validation of concierge SQL migrations. Does not apply them. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED_TABLES = [
  'TblSalonKnowledge',
  'TblSalonCapability',
  'TblSalonExternalLink',
  'TblSalonOffer',
  'TblSalonBrandVoice',
  'TblSalonKnowledgeGap',
  'TblSalonBrandVoiceExample',
  'TblSalonKnowledgeSource',
];

export function loadConciergeMigrationSql(root = process.cwd()): string {
  const v1 = readFileSync(join(root, 'db/migrations/create-tbl-salon-concierge.sql'), 'utf8');
  const v11 = readFileSync(join(root, 'db/migrations/add-tbl-salon-concierge-v11.sql'), 'utf8');
  return `${v1}\n${v11}`;
}

export function validateConciergeMigrationSql(sql: string): {
  ok: boolean;
  missingTables: string[];
  destructive: boolean;
  idempotentMarkers: boolean;
} {
  const missingTables = REQUIRED_TABLES.filter((t) => !sql.includes(t));
  const destructive = /\bDROP\s+TABLE\b/i.test(sql) || /\bTRUNCATE\b/i.test(sql);
  const idempotentMarkers =
    sql.includes('IF OBJECT_ID') && sql.includes('IF COL_LENGTH') && sql.includes('IF NOT EXISTS');
  return {
    ok: missingTables.length === 0 && !destructive && idempotentMarkers,
    missingTables,
    destructive,
    idempotentMarkers,
  };
}

#!/usr/bin/env npx tsx
/**
 * Apply Salon Concierge TblSalon* schema (idempotent).
 * Refuses unless --expected-database matches the connected database.
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

async function runSqlBatches(
  pool: { request: () => { batch: (sql: string) => Promise<unknown> } },
  batches: string[],
) {
  for (let i = 0; i < batches.length; i++) {
    console.log('running batch', i + 1, '/', batches.length);
    await pool.request().batch(batches[i]!);
  }
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  if (i < 0) return null;
  return process.argv[i + 1] ?? null;
}

const ALLOWED = new Set(['last132', 'last132_migrated']);

async function main() {
  const expected =
    arg('--expected-database') ||
    process.env.DB_DATABASE ||
    process.env.LOCAL_DB_NAME ||
    process.env.CLOUD_DB_NAME ||
    process.env.DB_NAME ||
    '';
  if (!expected) {
    throw new Error('Pass --expected-database <name> or set DB_DATABASE');
  }
  if (!ALLOWED.has(expected.toLowerCase())) {
    throw new Error(`Refuse unexpected database name: ${expected}`);
  }
  const { getPool, getDbConnectionInfo, getCurrentDbTarget, closePool } = await import(
    '../src/lib/db'
  );
  const target = getCurrentDbTarget();
  const info = getDbConnectionInfo();
  const resolved = target === 'local' ? info.local : info.cloud;
  console.log('salon-concierge migration');
  console.log(`  runtime target: ${target}`);
  console.log(`  server: ${resolved.server}`);
  console.log(`  database: ${resolved.database}`);
  if (String(resolved.database).toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`Refuse: connected ${resolved.database} != expected ${expected}`);
  }

  const pool = await getPool();
  const dbName = await pool.request().query(`SELECT DB_NAME() AS name`);
  const liveName = String(dbName.recordset[0]?.name || '');
  if (liveName.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`Refuse: live DB_NAME ${liveName} != expected ${expected}`);
  }

  const files = ['create-tbl-salon-concierge.sql', 'add-tbl-salon-concierge-v11.sql'];
  for (const file of files) {
    const text = fs.readFileSync(path.join(__dirname, '..', 'db/migrations', file), 'utf8');
    const batches = text.split(/^\s*GO\s*$/gim).map((b) => b.trim()).filter(Boolean);
    console.log(`--- apply ${file} (${batches.length} batches) ---`);
    await runSqlBatches(pool, batches);
  }

  const tables = await pool.request().query(`
    SELECT name FROM sys.tables
    WHERE name LIKE N'TblSalon%'
    ORDER BY name
  `);
  console.table(tables.recordset);
  const required = [
    'TblSalonKnowledge',
    'TblSalonCapability',
    'TblSalonExternalLink',
    'TblSalonOffer',
    'TblSalonBrandVoice',
    'TblSalonKnowledgeGap',
    'TblSalonBrandVoiceExample',
    'TblSalonKnowledgeSource',
  ];
  const present = new Set((tables.recordset as Array<{ name: string }>).map((r) => r.name));
  const missing = required.filter((n) => !present.has(n));
  if (missing.length) throw new Error(`Missing tables: ${missing.join(', ')}`);

  const voiceJson = JSON.stringify({
    dialect: 'egyptian_arabic',
    formality: 'polite_relaxed',
    warmth: 'high',
    humor: 'light_contextual',
    emojiUsage: 'low',
    messageLength: 'short',
    salesIntensity: 'help_first',
    greetingStyle: 'light',
    closingStyle: 'optional',
    preferredAddressTerms: ['يا فندم', 'حضرتك'],
    bannedAddressTerms: ['يا باشا', 'يا معلم', 'يا كبير', 'يا نجم', 'يا ريس', 'يا حاج'],
    preferredPhrases: ['تمام', 'حاضر'],
    bannedPhrases: ['يا باشا', 'يا معلم', 'يا كبير', 'يا نجم', 'يا ريس', 'الكتالوج', 'السيستم مش لاقي', 'ثواني هراجع'],
    behaviorRules: [
      'answer_current_first',
      'help_before_sell',
      'never_invent_salon_facts',
      'max_one_proactive_offer',
      'no_booking_nag',
      'honorific_situational',
    ],
  });
  const { sql } = await import('../src/lib/db');
  await pool
    .request()
    .input('json', sql.NVarChar(sql.MAX), voiceJson)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.TblSalonBrandVoice WHERE ProfileKey = N'default')
      BEGIN
        INSERT INTO dbo.TblSalonBrandVoice (ProfileKey, ConfigJson, Status)
        VALUES (N'default', @json, N'active');
        PRINT N'Inserted default BrandVoice style profile';
      END
    `);

  const counts = await pool.request().query(`
    SELECT 'Knowledge' AS kind, COUNT(*) AS n FROM dbo.TblSalonKnowledge
    UNION ALL SELECT 'Capability', COUNT(*) FROM dbo.TblSalonCapability
    UNION ALL SELECT 'Link', COUNT(*) FROM dbo.TblSalonExternalLink
    UNION ALL SELECT 'Offer', COUNT(*) FROM dbo.TblSalonOffer
    UNION ALL SELECT 'BrandVoice', COUNT(*) FROM dbo.TblSalonBrandVoice
    UNION ALL SELECT 'Gap', COUNT(*) FROM dbo.TblSalonKnowledgeGap
    UNION ALL SELECT 'VoiceExample', COUNT(*) FROM dbo.TblSalonBrandVoiceExample
    UNION ALL SELECT 'Source', COUNT(*) FROM dbo.TblSalonKnowledgeSource
  `);
  console.table(counts.recordset);
  await closePool();
  console.log('salon concierge schema migration OK');
}

main().catch((e) => {
  console.error('migration failed', e instanceof Error ? e.message : e);
  process.exit(1);
});

// Idempotent migration: create TblSensitiveActionAuditLog
// Run with: node scripts/migrate-sensitive-audit-log.mjs

import sql from 'mssql';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const config = {
  server:   process.env.CLOUD_DB_SERVER   || process.env.DB_SERVER   || '',
  port:     parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
  database: process.env.CLOUD_DB_NAME     || process.env.DB_DATABASE || 'HawaiRestaurant',
  user:     process.env.CLOUD_DB_USER     || process.env.DB_USER     || '',
  password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
  options:  { encrypt: true, trustServerCertificate: process.env.CLOUD_DB_TRUST_CERT === 'true', enableArithAbort: true },
  connectionTimeout: 30000, requestTimeout: 30000,
};

async function main() {
  console.log('Connecting...');
  const pool = await new sql.ConnectionPool(config).connect();
  console.log('Connected \u2713\n');

  const sqlPath = join(__dirname, '..', 'src', 'lib', 'migrations', 'sensitive-audit-log.sql');
  const sqlText = readFileSync(sqlPath, 'utf-8');

  console.log('Running sensitive-audit-log migration...');
  await pool.request().batch(sqlText);
  console.log('  \u2713 Migration applied.');

  console.log('\n\u2705 Migration complete!');
  await pool.close();
}

main().catch(err => { console.error('\u274c', err.message); process.exit(1); });

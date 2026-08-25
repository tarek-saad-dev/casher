#!/usr/bin/env npx tsx
/**
 * Apply db/migrations/create-tbl-message-template.sql to the same DB
 * Casher runtime uses (getPool target). Never prints secrets.
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

async function main() {
  const { getPool, getDbConnectionInfo, getCurrentDbTarget, closePool } = await import(
    '../src/lib/db'
  );

  const target = getCurrentDbTarget();
  const info = getDbConnectionInfo();
  const resolved = target === 'local' ? info.local : info.cloud;
  console.log('message-template migration');
  console.log(`  runtime target: ${target}`);
  console.log(`  server: ${resolved.server}`);
  console.log(`  database: ${resolved.database}`);
  console.log(`  migration: create-tbl-message-template.sql`);

  const pool = await getPool();
  const text = fs.readFileSync(
    path.join(__dirname, '..', 'db/migrations/create-tbl-message-template.sql'),
    'utf8',
  );
  const batches = text.split(/^\s*GO\s*$/gim).map((b) => b.trim()).filter(Boolean);
  console.log('batches', batches.length);

  for (let i = 0; i < batches.length; i++) {
    console.log('running batch', i + 1);
    await pool.request().batch(batches[i]);
  }

  const who = await pool.request().query(`
    SELECT DB_NAME() AS dbName, @@SERVERNAME AS serverName
  `);
  console.log('connected dbName', who.recordset[0]?.dbName);
  console.log('connected serverName', who.recordset[0]?.serverName);

  const check = await pool.request().query(`
    SELECT t.ID, t.TemplateKey, t.Channel, t.BranchID, t.Language, t.IsActive, t.Version
    FROM dbo.TblMessageTemplate t
    WHERE t.TemplateKey = N'sale.customer_receipt'
    ORDER BY t.ID
  `);
  console.table(check.recordset);
  console.log('sale.customer_receipt row count', check.recordset.length);

  for (let i = 0; i < batches.length; i++) {
    await pool.request().batch(batches[i]);
  }

  const again = await pool.request().query(`
    SELECT COUNT(*) AS cnt
    FROM dbo.TblMessageTemplate
    WHERE TemplateKey = N'sale.customer_receipt'
  `);
  console.log('Idempotent re-run OK; sale.customer_receipt count', again.recordset[0]?.cnt);
  await closePool();
}

main().catch((e) => {
  const message = e instanceof Error ? e.message : String(e);
  const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
  console.error('migration failed', code || '', message);
  process.exit(1);
});

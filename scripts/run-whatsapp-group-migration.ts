#!/usr/bin/env npx tsx
/**
 * Apply WhatsApp group notification tables (idempotent).
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

async function applyBatches(pool: Awaited<ReturnType<typeof import('../src/lib/db')['getPool']>>, filePath: string) {
  const text = fs.readFileSync(filePath, 'utf8');
  const batches = text.split(/^\s*GO\s*$/gim).map((b) => b.trim()).filter(Boolean);
  for (const batch of batches) {
    await pool.request().batch(batch);
  }
  return batches.length;
}

async function main() {
  const { getPool, getDbConnectionInfo, getCurrentDbTarget, closePool } = await import(
    '../src/lib/db'
  );

  const target = getCurrentDbTarget();
  const info = getDbConnectionInfo();
  const resolved = target === 'local' ? info.local : info.cloud;
  console.log('whatsapp group migration');
  console.log(`  runtime target: ${target}`);
  console.log(`  server: ${resolved.server}`);
  console.log(`  database: ${resolved.database}`);

  const pool = await getPool();
  const root = path.join(__dirname, '..');
  const migrationPath = path.join(root, 'db/migrations/create-tbl-whatsapp-group.sql');

  const batches = await applyBatches(pool, migrationPath);
  console.log('group table batches', batches);

  const tables = await pool.request().query(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = N'TblWhatsAppGroup'
  `);
  console.table(tables.recordset);

  await applyBatches(pool, migrationPath);
  console.log('Idempotent re-run OK');
  await closePool();
}

main().catch((e) => {
  const message = e instanceof Error ? e.message : String(e);
  console.error('migration failed', message);
  process.exit(1);
});

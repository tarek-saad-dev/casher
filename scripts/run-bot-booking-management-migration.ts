#!/usr/bin/env npx tsx
/**
 * Apply Booking Management V1 schema (idempotent).
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
  console.log('booking-management migration');
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

  const file = 'create-tbl-bot-booking-management-plan.sql';
  const text = fs.readFileSync(path.join(__dirname, '..', 'db/migrations', file), 'utf8');
  const batches = text.split(/^\s*GO\s*$/gim).map((b) => b.trim()).filter(Boolean);
  console.log(`--- apply ${file} (${batches.length} batches) ---`);
  await runSqlBatches(pool, batches);

  const tables = await pool.request().query(`
    SELECT name FROM sys.tables
    WHERE name = N'TblBotBookingManagementPlan'
  `);
  console.table(tables.recordset);
  if ((tables.recordset as Array<{ name: string }>).length < 1) {
    throw new Error('Missing table TblBotBookingManagementPlan');
  }

  await closePool();
  console.log('booking management schema migration OK');
}

main().catch((e) => {
  console.error('migration failed', e instanceof Error ? e.message : e);
  process.exit(1);
});

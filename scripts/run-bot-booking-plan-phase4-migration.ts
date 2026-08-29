#!/usr/bin/env npx tsx
/**
 * Apply Phase 4 TblBotBookingPlan execution stages + booking link columns.
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
    console.log('running batch', i + 1);
    await pool.request().batch(batches[i]!);
  }
}

async function main() {
  const { getPool, getDbConnectionInfo, getCurrentDbTarget, closePool } = await import(
    '../src/lib/db'
  );
  const target = getCurrentDbTarget();
  const info = getDbConnectionInfo();
  const resolved = target === 'local' ? info.local : info.cloud;
  console.log('bot-booking-plan phase4 migration');
  console.log(`  runtime target: ${target}`);
  console.log(`  server: ${resolved.server}`);
  console.log(`  database: ${resolved.database}`);

  const pool = await getPool();
  const file = 'alter-tbl-bot-booking-plan-phase4-execution.sql';
  const text = fs.readFileSync(path.join(__dirname, '..', 'db/migrations', file), 'utf8');
  const batches = text
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter(Boolean);
  console.log(`--- apply ${file} (${batches.length} batches) ---`);
  await runSqlBatches(pool, batches);

  const cols = await pool.request().query(`
    SELECT c.name
    FROM sys.columns c
    WHERE c.object_id = OBJECT_ID(N'dbo.TblBotBookingPlan')
      AND c.name IN (N'BookingID', N'BookingCode', N'IdempotencyKey', N'ExecutionErrorCode')
    ORDER BY c.name
  `);
  console.table(cols.recordset);
  if ((cols.recordset as Array<{ name: string }>).length < 4) {
    throw new Error('Phase 4 booking plan columns missing');
  }

  await closePool();
  console.log('Phase 4 booking plan execution schema migration OK');
}

main().catch((e) => {
  console.error('migration failed', e instanceof Error ? e.message : e);
  process.exit(1);
});

#!/usr/bin/env npx tsx
/**
 * Apply Phase 2 conversation/message tables.
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
    await pool.request().batch(batches[i]);
  }
}

async function main() {
  const { getPool, getDbConnectionInfo, getCurrentDbTarget, closePool } = await import(
    '../src/lib/db'
  );

  const target = getCurrentDbTarget();
  const info = getDbConnectionInfo();
  const resolved = target === 'local' ? info.local : info.cloud;
  console.log('bot-conversation migration');
  console.log(`  runtime target: ${target}`);
  console.log(`  server: ${resolved.server}`);
  console.log(`  database: ${resolved.database}`);

  const pool = await getPool();
  for (const file of ['create-tbl-bot-conversation.sql', 'create-tbl-bot-message.sql']) {
    const text = fs.readFileSync(path.join(__dirname, '..', 'db/migrations', file), 'utf8');
    const batches = text.split(/^\s*GO\s*$/gim).map((b) => b.trim()).filter(Boolean);
    console.log(`--- apply ${file} (${batches.length} batches) ---`);
    await runSqlBatches(pool, batches);
  }

  const tables = await pool.request().query(`
    SELECT name
    FROM sys.tables
    WHERE name IN (N'TblBotConversation', N'TblBotMessage')
    ORDER BY name
  `);
  console.table(tables.recordset);
  if ((tables.recordset as Array<{ name: string }>).length !== 2) {
    throw new Error('Phase 2 tables were not created');
  }

  await closePool();
  console.log('Phase 2 conversation schema migration OK');
}

main().catch((e) => {
  const message = e instanceof Error ? e.message : String(e);
  console.error('migration failed', message);
  process.exit(1);
});

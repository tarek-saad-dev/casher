#!/usr/bin/env npx tsx
/**
 * Populate Salon Concierge knowledge from production ERP + official CUT website.
 * Does not enable SALON_CONCIERGE_BRAIN_V1.
 */
import path from 'path';
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
  if (!expected) throw new Error('Pass --expected-database <name> or set DB_DATABASE');
  if (!ALLOWED.has(expected.toLowerCase())) {
    throw new Error(`Refuse unexpected database name: ${expected}`);
  }

  const { getPool, getDbConnectionInfo, getCurrentDbTarget, closePool } = await import('../src/lib/db');
  const target = getCurrentDbTarget();
  const info = getDbConnectionInfo();
  const resolved = target === 'local' ? info.local : info.cloud;
  console.log('salon-concierge knowledge bootstrap');
  console.log(`  runtime target: ${target}`);
  console.log(`  server: ${resolved.server}`);
  console.log(`  database: ${resolved.database}`);
  if (String(resolved.database).toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`Refuse: connected ${resolved.database} != expected ${expected}`);
  }

  const pool = await getPool();
  const liveName = String((await pool.request().query(`SELECT DB_NAME() AS name`)).recordset[0]?.name || '');
  if (liveName.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`Refuse: live DB_NAME ${liveName} != expected ${expected}`);
  }

  const { bootstrapSalonConciergeKnowledge } = await import(
    '../src/modules/messaging/ai/salonConcierge/bootstrapKnowledge'
  );
  const report = await bootstrapSalonConciergeKnowledge();
  console.log(JSON.stringify(report, null, 2));
  await closePool();
  if (!report.ok) {
    throw new Error('Bootstrap validation failed');
  }
  console.log('salon concierge knowledge bootstrap OK — flag unchanged');
}

main().catch((e) => {
  console.error('bootstrap failed', e instanceof Error ? e.message : e);
  process.exit(1);
});

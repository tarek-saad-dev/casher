/**
 * Apply create-tbl-marketing-consent-evidence.sql (consent table + paused campaign status).
 * Usage: npx tsx scripts/run-marketing-consent-evidence-migration.ts [--local|--cloud]
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import Module from 'module';

const mod = Module as any;
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

function loadEnvLocal(): void {
  for (const envPath of ['.env.local', '.env']) {
    const full = path.join(process.cwd(), envPath);
    if (!existsSync(full)) continue;
    for (const line of readFileSync(full, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        let value = match[2].trim();
        value = value.replace(/^["']|["']$/g, '');
        process.env[match[1]] = value;
      }
    }
  }
}

async function main() {
  loadEnvLocal();
  const useLocal = process.argv.includes('--local') || process.env.HAWAI_DB_CLASS === 'local';
  if (useLocal) process.env.HAWAI_DB_CLASS = 'local';
  const allowProduction = process.argv.includes('--allow-production');

  const { getLocalPool, getCloudPool, getPool } = await import('../src/lib/db');
  const pool = useLocal ? await getLocalPool() : process.argv.includes('--cloud') ? await getCloudPool() : await getPool();

  const id = await pool.request().query(`SELECT DB_NAME() AS dbName, SUSER_SNAME() AS loginName`);
  console.log('Connected', id.recordset[0]);

  const dbName = String(id.recordset[0]?.dbName ?? '');
  if (dbName === 'last132' && !allowProduction) {
    throw new Error(
      'Refusing to mutate production last132. Use staging last132_agent, or pass --allow-production after human approval.',
    );
  }
  if (dbName === 'last132_agent') {
    const who = await pool.request().query(`SELECT SUSER_SNAME() AS loginName`);
    const login = String(who.recordset[0]?.loginName ?? '');
    if (login !== 'drvo_agent') {
      console.warn(`Warning: staging DB but login is ${login} (expected drvo_agent)`);
    }
  }

  // Prefer the DRVO-020 canonical schema (manifest-bound). Legacy db/migrations copy is a mirror.
  const sqlPath = path.join(
    process.cwd(),
    'db/drvo-migrations/020-marketing-consent-evidence/schema.sql',
  );
  const { executeSqlFile } = await import('./drvo/sqlBatch');
  const { verifyMarketingConsentEvidenceSchema } = await import(
    './drvo/migrations/020-marketing-consent-evidence'
  );
  await executeSqlFile(pool, sqlPath);

  const verify = await verifyMarketingConsentEvidenceSchema(pool);
  console.log('Verify', verify);
  if (!verify.ok) {
    throw new Error(`Migration verify failed: ${verify.failures.join('; ')}`);
  }
  console.log('Done.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

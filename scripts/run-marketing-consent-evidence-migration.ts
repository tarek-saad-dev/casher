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

  const sqlPath = path.join(process.cwd(), 'db/migrations/create-tbl-marketing-consent-evidence.sql');
  const sqlText = readFileSync(sqlPath, 'utf8');
  for (const batch of sqlText.split(/^\s*GO\s*$/gim)) {
    const trimmed = batch.trim();
    if (!trimmed) continue;
    await pool.request().query(trimmed);
  }

  const check = await pool.request().query(`
    SELECT
      CASE WHEN OBJECT_ID(N'dbo.TblMarketingConsentEvidence', N'U') IS NULL THEN 0 ELSE 1 END AS consentTable,
      (SELECT definition FROM sys.check_constraints WHERE name = N'CK_TblWhatsAppCampaign_Status') AS statusCheck
  `);
  console.log('Verify', check.recordset[0]);
  console.log('Done.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

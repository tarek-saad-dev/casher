/**
 * Apply Phase 1L employee-financial BranchID migration to cloud last132.
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const sql = require('mssql');

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

function buildConfig() {
  return {
    server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
    port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
    database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || process.env.DB_NAME || '',
    user: process.env.CLOUD_DB_USER || process.env.DB_USER || '',
    password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
    options: {
      encrypt: true,
      trustServerCertificate:
        process.env.CLOUD_DB_TRUST_CERT === 'true' ||
        process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
      enableArithAbort: true,
    },
    requestTimeout: 300000,
  };
}

function splitBatches(sqlText) {
  return sqlText
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

async function main() {
  const file = path.join(
    process.cwd(),
    'db',
    'migrations',
    'add-employee-financial-branch-ownership.sql',
  );
  const batches = splitBatches(fs.readFileSync(file, 'utf8'));
  const pool = await sql.connect(buildConfig());
  try {
    const db = (await pool.request().query('SELECT DB_NAME() AS n')).recordset[0].n;
    if (db !== 'last132') throw new Error(`Expected last132, got ${db}`);
    console.log(`[phase1l] applying ${batches.length} batches to ${db}`);
    for (let i = 0; i < batches.length; i++) {
      try {
        await pool.request().batch(batches[i]);
        console.log(`  batch ${i + 1}/${batches.length} OK`);
      } catch (err) {
        console.error(`  batch ${i + 1} FAILED`);
        console.error(batches[i].slice(0, 600));
        throw err;
      }
    }
    console.log('[phase1l] migration complete');
  } finally {
    await pool.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

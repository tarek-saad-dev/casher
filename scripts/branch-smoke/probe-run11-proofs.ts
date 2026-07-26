#!/usr/bin/env npx tsx
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });

async function main() {
  const pool = await sql.connect({
    server: process.env.CLOUD_DB_SERVER || '',
    port: parseInt(process.env.CLOUD_DB_PORT || '1433', 10),
    database: process.env.CLOUD_DB_NAME || '',
    user: process.env.CLOUD_DB_USER || '',
    password: process.env.CLOUD_DB_PASSWORD || '',
    options: { encrypt: true, trustServerCertificate: true, enableArithAbort: true },
  });
  const r = await pool.request().query(`
    SELECT SmokeRunID, Status, CleanupStatus,
           CASE WHEN ResultJson IS NULL THEN 0 ELSE LEN(ResultJson) END AS JsonLen
    FROM dbo.TblBranchSmokeRun WHERE SmokeRunID=11
  `);
  const full = await pool.request().query(`
    SELECT ResultJson FROM dbo.TblBranchSmokeRun WHERE SmokeRunID=11
  `);
  let keys: string[] = [];
  let sample: unknown = null;
  if (full.recordset[0]?.ResultJson) {
    const j = JSON.parse(String(full.recordset[0].ResultJson));
    const proofs = j.proofs && typeof j.proofs === 'object' ? j.proofs : j;
    keys = Object.keys(proofs);
    sample = proofs;
  }
  const out = { meta: r.recordset[0], keys, sample };
  fs.writeFileSync(path.join(__dirname, '_run11-proof-keys.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ meta: out.meta, keys }, null, 2));
  await pool.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

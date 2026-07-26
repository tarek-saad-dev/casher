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
  const tables = [
    'TblEmpWorkSchedule',
    'TblEmpTargetPlan',
    'TblEmpBranchAssignment',
    'TblEmpBranchPayrollPlan',
    'TblBranchLifecycleAudit',
  ];
  const out: Record<string, unknown> = {};
  for (const t of tables) {
    const r = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${t}' ORDER BY ORDINAL_POSITION
    `);
    out[t] = r.recordset;
  }
  fs.writeFileSync(path.join(__dirname, '_phase1o-cols.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await pool.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

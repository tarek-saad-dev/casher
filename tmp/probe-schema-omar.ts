#!/usr/bin/env npx tsx
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const o = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};

async function main() {
  const { getPool } = await import('../src/lib/db');
  const db = await getPool();
  for (const t of [
    'TblEmpTargetPlan',
    'TblEmpTargetTier',
    'TblEmpDailyTarget',
    'TblEmpDailyPayroll',
    'TblEmpLedgerEntry',
  ]) {
    const r = await db.request().query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='${t}'
      ORDER BY ORDINAL_POSITION
    `);
    console.log(t + ':', (r.recordset as Array<{ COLUMN_NAME: string }>).map((x) => x.COLUMN_NAME).join(', '));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

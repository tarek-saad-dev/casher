#!/usr/bin/env npx tsx
/** READ-ONLY dump TblNewDay + TblShiftMove from Azure last132. */
import fs from 'node:fs';
import path from 'node:path';
import sql from 'mssql';

function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[t.slice(0, i).trim()] = v;
  }
  return out;
}

async function main() {
  const azure = parseEnvFile(path.join(process.cwd(), '.env.local'));
  const pool = await new sql.ConnectionPool({
    server: azure.DB_SERVER,
    port: parseInt(azure.DB_PORT || '1433', 10),
    database: azure.DB_DATABASE,
    user: azure.DB_USER,
    password: azure.DB_PASSWORD,
    options: { encrypt: true, trustServerCertificate: false },
    requestTimeout: 60000,
  }).connect();
  const tables = ['TblNewDay', 'TblShiftMove'];
  const out: Record<string, unknown> = {};
  try {
    for (const table of tables) {
      const cols = await pool.request().input('t', sql.NVarChar, table).query(`
        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE,
               IS_NULLABLE, COLUMN_DEFAULT,
               COLUMNPROPERTY(OBJECT_ID('dbo.' + @t), COLUMN_NAME, 'IsIdentity') AS IsIdentity
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA=N'dbo' AND TABLE_NAME=@t
        ORDER BY ORDINAL_POSITION
      `);
      const fks = await pool.request().input('t', sql.NVarChar, table).query(`
        SELECT fk.name AS FK_NAME, COL_NAME(fc.parent_object_id, fc.parent_column_id) AS COL,
               OBJECT_NAME(fk.referenced_object_id) AS REF_TABLE
        FROM sys.foreign_keys fk
        JOIN sys.foreign_key_columns fc ON fc.constraint_object_id = fk.object_id
        WHERE fk.parent_object_id = OBJECT_ID('dbo.' + @t)
      `);
      out[table] = { columns: cols.recordset, foreignKeys: fks.recordset };
      console.log(table, cols.recordset.map((c: { COLUMN_NAME: string; DATA_TYPE: string; IS_NULLABLE: string; IsIdentity: number }) => `${c.COLUMN_NAME}:${c.DATA_TYPE}${c.IsIdentity ? '(id)' : ''}${c.IS_NULLABLE==='NO'?'!':''}`).join(', '));
    }
  } finally {
    await pool.close();
  }
  const dir = path.join(process.cwd(), 'tmp', 'booking-v2-isolated-auth');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'azure-day-shift-schema.json'), JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });

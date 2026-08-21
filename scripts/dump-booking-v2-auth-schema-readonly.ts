#!/usr/bin/env npx tsx
/**
 * READ-ONLY dump of AUTH schema from Azure last132.
 * Never INSERT/UPDATE/DELETE/DDL on Azure.
 */
import fs from 'node:fs';
import path from 'node:path';
import sql from 'mssql';

const TABLES = [
  'TblShift',
  'TblUser',
  'TblUserBranchAccess',
  'TblRoles',
  'TblUserRoles',
  'TblSystemPages',
  'TblPageRoleAccess',
];

function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[t.slice(0, i).trim()] = v;
  }
  return out;
}

async function main() {
  const azure = parseEnvFile(path.join(process.cwd(), '.env.local'));
  const server = azure.DB_SERVER || azure.CLOUD_DB_SERVER || '';
  const database = azure.DB_DATABASE || azure.CLOUD_DB_NAME || '';
  if (!/\.database\.windows\.net$/i.test(server)) {
    throw new Error(`Expected Azure source, got ${server}`);
  }

  const pool = await new sql.ConnectionPool({
    server,
    port: parseInt(azure.DB_PORT || '1433', 10),
    database,
    user: azure.DB_USER || azure.CLOUD_DB_USER || '',
    password: azure.DB_PASSWORD || azure.CLOUD_DB_PASSWORD || '',
    options: { encrypt: true, trustServerCertificate: false, enableArithAbort: true },
    requestTimeout: 60000,
  }).connect();

  const out: Record<string, unknown> = {
    source: { server, database, mode: 'READ_ONLY' },
    tables: {},
  };

  try {
    const probe = await pool.request().query(`SELECT DB_NAME() AS db, @@SERVERNAME AS srv`);
    console.log(`[dump-auth] connected READ-ONLY db=${probe.recordset[0].db}`);

    for (const table of TABLES) {
      const exists = await pool.request().input('t', sql.NVarChar, table).query(`
        SELECT CASE WHEN OBJECT_ID(N'dbo.' + @t, N'U') IS NULL THEN 0 ELSE 1 END AS ok
      `);
      if (Number(exists.recordset[0].ok) !== 1) {
        (out.tables as Record<string, unknown>)[table] = { exists: false };
        continue;
      }

      const cols = await pool.request().input('t', sql.NVarChar, table).query(`
        SELECT
          c.COLUMN_NAME, c.DATA_TYPE, c.CHARACTER_MAXIMUM_LENGTH,
          c.NUMERIC_PRECISION, c.NUMERIC_SCALE, c.IS_NULLABLE, c.COLUMN_DEFAULT,
          COLUMNPROPERTY(OBJECT_ID('dbo.' + @t), c.COLUMN_NAME, 'IsIdentity') AS IsIdentity
        FROM INFORMATION_SCHEMA.COLUMNS c
        WHERE c.TABLE_SCHEMA=N'dbo' AND c.TABLE_NAME=@t
        ORDER BY c.ORDINAL_POSITION
      `);

      const pks = await pool.request().input('t', sql.NVarChar, table).query(`
        SELECT kcu.COLUMN_NAME, kcu.ORDINAL_POSITION
        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
          ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_NAME = kcu.TABLE_NAME
        WHERE tc.TABLE_SCHEMA=N'dbo' AND tc.TABLE_NAME=@t AND tc.CONSTRAINT_TYPE='PRIMARY KEY'
        ORDER BY kcu.ORDINAL_POSITION
      `);

      const fks = await pool.request().input('t', sql.NVarChar, table).query(`
        SELECT
          fk.name AS FK_NAME,
          COL_NAME(fc.parent_object_id, fc.parent_column_id) AS COL,
          OBJECT_NAME(fk.referenced_object_id) AS REF_TABLE,
          COL_NAME(fc.referenced_object_id, fc.referenced_column_id) AS REF_COL
        FROM sys.foreign_keys fk
        JOIN sys.foreign_key_columns fc ON fc.constraint_object_id = fk.object_id
        WHERE fk.parent_object_id = OBJECT_ID('dbo.' + @t)
      `);

      const indexes = await pool.request().input('t', sql.NVarChar, table).query(`
        SELECT i.name, i.is_unique, i.is_primary_key, i.filter_definition,
               STUFF((
                 SELECT ',' + c.name
                 FROM sys.index_columns ic
                 JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
                 WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id
                 ORDER BY ic.key_ordinal
                 FOR XML PATH('')
               ),1,1,'') AS cols
        FROM sys.indexes i
        WHERE i.object_id = OBJECT_ID('dbo.' + @t) AND i.name IS NOT NULL
      `);

      const checks = await pool.request().input('t', sql.NVarChar, table).query(`
        SELECT cc.name, cc.definition
        FROM sys.check_constraints cc
        WHERE cc.parent_object_id = OBJECT_ID('dbo.' + @t)
      `);

      const rowCount = await pool.request().query(`SELECT COUNT(*) AS n FROM dbo.[${table}]`);

      (out.tables as Record<string, unknown>)[table] = {
        exists: true,
        columns: cols.recordset,
        primaryKey: pks.recordset,
        foreignKeys: fks.recordset,
        indexes: indexes.recordset,
        checks: checks.recordset,
        rowCount: Number(rowCount.recordset[0].n),
      };
      console.log(
        `[dump-auth] ${table}: cols=${cols.recordset.length} rows=${rowCount.recordset[0].n} (counts only, no password rows)`,
      );
    }
  } finally {
    await pool.close();
  }

  const dir = path.join(process.cwd(), 'tmp', 'booking-v2-isolated-auth');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'azure-auth-schema.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
  console.log(`[dump-auth] wrote ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

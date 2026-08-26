#!/usr/bin/env node
/* eslint-disable */
const fs = require('fs');
const path = require('path');
const sql = require('mssql');

function loadEnv(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (process.env[m[1]] == null) process.env[m[1]] = v;
    }
  } catch (_) {}
}

async function main() {
  loadEnv(path.join(process.cwd(), '.env.local'));
  loadEnv(path.join(process.cwd(), '.env'));
  const pool = await sql.connect({
    server: '127.0.0.1',
    port: 1433,
    database: process.env.DB_DATABASE || process.env.LOCAL_DB_NAME || 'last132',
    user: process.env.DB_USER || process.env.LOCAL_DB_USER,
    password: process.env.DB_PASSWORD || process.env.LOCAL_DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });
  try {
    const del = await pool.request().query(`
      DELETE FROM dbo.TblBookingBootstrapSnapshot WHERE ScopeKey = N'public:all';
      SELECT @@ROWCOUNT AS Deleted;
    `);
    console.log('deleted', del.recordset[0]);
  } catch (e) {
    console.log('delete_skip', e.message);
  }
  await pool.close();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

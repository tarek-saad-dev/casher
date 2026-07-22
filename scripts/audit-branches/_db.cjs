/**
 * Shared read-only DB connection for branch audit scripts.
 * SELECT / catalog queries only — no writers imported here.
 */
const path = require('path');
const fs = require('fs');
const sql = require('mssql');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(path.join(__dirname, '..', '..', '.env'));
loadEnvFile(path.join(__dirname, '..', '..', '.env.local'));

function buildConfig(target) {
  const useLocal = target === 'local';
  if (useLocal) {
    return {
      server: process.env.LOCAL_DB_SERVER || process.env.DB_SERVER || '',
      port: parseInt(process.env.LOCAL_DB_PORT || process.env.DB_PORT || '1433', 10),
      database: process.env.LOCAL_DB_NAME || process.env.DB_DATABASE || process.env.DB_NAME || 'HawaiDB',
      user: process.env.LOCAL_DB_USER || process.env.DB_USER || '',
      password: process.env.LOCAL_DB_PASSWORD || process.env.DB_PASSWORD || '',
      options: {
        encrypt: process.env.LOCAL_DB_ENCRYPT === 'true' || process.env.DB_ENCRYPT === 'true',
        trustServerCertificate:
          process.env.LOCAL_DB_TRUST_CERT === 'true' ||
          process.env.DB_TRUST_CERT === 'true' ||
          true,
      },
    };
  }
  return {
    server: process.env.CLOUD_DB_SERVER || process.env.DB_SERVER || '',
    port: parseInt(process.env.CLOUD_DB_PORT || process.env.DB_PORT || '1433', 10),
    database: process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || process.env.DB_NAME || 'HawaiRestaurant',
    user: process.env.CLOUD_DB_USER || process.env.DB_USER || '',
    password: process.env.CLOUD_DB_PASSWORD || process.env.DB_PASSWORD || '',
    options: {
      encrypt: process.env.CLOUD_DB_ENCRYPT === 'true' || process.env.DB_ENCRYPT === 'true',
      trustServerCertificate:
        process.env.CLOUD_DB_TRUST_CERT === 'true' || process.env.DB_TRUST_CERT === 'true',
    },
  };
}

async function connectReadOnly() {
  const target = (process.env.AUDIT_DB_TARGET || 'cloud').toLowerCase();
  const config = buildConfig(target);
  if (!config.server || !config.user) {
    throw new Error(
      'Missing DB connection env. Set CLOUD_DB_* or LOCAL_DB_* (see scripts/audit-branches/README.md).'
    );
  }
  const pool = await sql.connect(config);
  console.error(`[audit-branches] connected target=${target} database=${config.database}`);
  return { pool, sql, target, database: config.database };
}

module.exports = { connectReadOnly, sql };

/**
 * Apply the customer-source detail-columns migration to the cloud DB.
 * Reads credentials from the environment (loaded via --env-file=.env.local).
 */
import sql from 'mssql';
import fs from 'fs';
import path from 'path';

const server = process.env.DB_SERVER;
const database = process.env.DB_DATABASE;
const user = process.env.DB_USER;
const password = process.env.DB_PASSWORD;
const port = parseInt(process.env.DB_PORT || '1433', 10);
const encrypt = process.env.DB_ENCRYPT !== 'false';
const trustServerCertificate = process.env.DB_TRUST_SERVER_CERTIFICATE === 'true';

if (!server || !database || !user || !password) {
  console.error('Missing DB credentials in environment');
  process.exit(1);
}

const config = {
  server,
  database,
  user,
  password,
  port,
  options: {
    encrypt,
    trustServerCertificate,
    enableArithAbort: true,
  },
  connectionTimeout: 60000,
  requestTimeout: 60000,
};

const migrationPath = path.join(process.cwd(), 'db', 'migrations', 'add-customer-source-detail-columns.sql');
const migrationSql = fs.readFileSync(migrationPath, 'utf8');

const batches = migrationSql
  .split(/^\s*GO\s*$/gim)
  .map((b) => b.trim())
  .filter(Boolean);

console.log(`Connecting to cloud DB: ${server}:${port}/${database}`);

const pool = await new sql.ConnectionPool(config).connect();

try {
  for (const batch of batches) {
    const result = await pool.request().query(batch);
    if (result.recordset?.length) {
      console.log(result.recordset);
    }
  }
  console.log('Migration applied successfully.');
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exit(1);
} finally {
  await pool.close();
  console.log('Connection closed.');
}

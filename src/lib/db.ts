import sql from 'mssql';

const config: sql.config = {
  server: process.env.DB_SERVER || 'DESKTOP-EUN2CV2',
  database: process.env.DB_NAME || 'HawaiDB',
  user: process.env.DB_USER || 'it',
  password: process.env.DB_PASSWORD || '123',
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_CERT !== 'false',
    enableArithAbort: true,
  },
  connectionTimeout: 15000,
  requestTimeout: 30000,
  pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
};

let pool: sql.ConnectionPool | null = null;

export async function getPool(): Promise<sql.ConnectionPool> {
  if (pool) return pool;
  pool = await sql.connect(config);
  console.log('[pos-db] Connected to SQL Server');
  return pool;
}

export { sql };

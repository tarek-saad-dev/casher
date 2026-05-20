import sql from 'mssql';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '1433'),
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
  },
};

console.log(`Connecting to: ${config.server} / ${config.database}`);

try {
  const pool = await sql.connect(config);

  // ── Run migration ──────────────────────────────────────────────────────────
  const migrationSql = readFileSync(
    join(__dirname, '..', 'db', 'migrations', 'add-booking-code-column.sql'),
    'utf8'
  );

  // Split on GO statements (T-SQL batch separator) and run each batch
  const batches = migrationSql.split(/^\s*GO\s*$/im).map(b => b.trim()).filter(Boolean);

  for (const batch of batches) {
    const result = await pool.request().query(batch);
    if (result.recordset) console.log(result.recordset);
  }

  // ── Verify result ──────────────────────────────────────────────────────────
  const cols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Bookings' AND COLUMN_NAME = 'BookingCode'
  `);

  if (cols.recordset.length > 0) {
    console.log('\n✅ BookingCode column confirmed:', cols.recordset[0]);
  } else {
    console.error('\n❌ BookingCode column NOT found after migration!');
    process.exit(1);
  }

  const idx = await pool.request().query(`
    SELECT name, is_unique, filter_definition
    FROM sys.indexes
    WHERE name = 'UX_Bookings_BookingCode'
      AND object_id = OBJECT_ID('dbo.Bookings')
  `);

  if (idx.recordset.length > 0) {
    console.log('✅ Unique index confirmed:', idx.recordset[0]);
  } else {
    console.warn('⚠️  UX_Bookings_BookingCode index not found');
  }

  const backfill = await pool.request().query(`
    SELECT COUNT(*) AS NullCount FROM dbo.Bookings WHERE BookingCode IS NULL
  `);
  console.log('Rows still with NULL BookingCode:', backfill.recordset[0].NullCount);

  await pool.close();
  console.log('\n✅ Migration complete. Production DB is ready for public booking.');
} catch (err) {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
}

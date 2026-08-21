#!/usr/bin/env npx tsx
/**
 * Provision isolated Booking V2 write-test DB on local SQL Express.
 *
 * SOURCE (READ-ONLY): Azure last132 via .env.local — SELECT only, never INSERT/UPDATE/DELETE.
 * DEST (WRITES): .\SQLEXPRESS / HawaiBookingV2Isolated
 *
 * Usage:
 *   npx tsx scripts/provision-booking-v2-isolated-db.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import sql from 'mssql';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

const DEST_SERVER = process.env.BOOKING_V2_TEST_DB_SERVER || '.\\SQLEXPRESS';
const DEST_DB = process.env.BOOKING_V2_TEST_DB_NAME || 'HawaiBookingV2Isolated';

/** Reference tables: copy structure + rows (READ from Azure). */
const SEED_TABLES = [
  'TblBranch',
  'QueueBookingSettings',
  'TblEmp',
  'TblEmpBranchAssignment',
  'TblEmpBranchWorkSchedule',
  'TblEmpWorkSchedule',
  'TblCat',
  'TblPro',
  'TblEmpAttendance',
  'TblEmpTemporaryBranchTransfer',
  'TblEmpScheduleOverrides',
  'TblEmpDailyAdjustment',
  'TblBranchExceptionalHours',
  'TblEmpServiceSettings',
  'TblClient',
];

/** Transactional: structure only (empty). */
const EMPTY_TABLES = [
  'Bookings',
  'BookingServices',
  'TblBookingHold',
  'QueueTickets',
  'QueueTicketServices',
  'TblPublicBookingCreateRequest',
  'TblPublicBookingCancelRequest',
  'TblBookingNotifyRequest',
];

const V2_MIGRATIONS = [
  'create-booking-slot-claims.sql',
  'create-weekly-baseline-projection.sql',
  'create-effective-day-projection.sql',
  'create-booking-availability-revision.sql',
  'create-booking-bootstrap-snapshot.sql',
  'add-public-booking-create-idempotency.sql',
];

type Col = {
  COLUMN_NAME: string;
  DATA_TYPE: string;
  CHARACTER_MAXIMUM_LENGTH: number | null;
  NUMERIC_PRECISION: number | null;
  NUMERIC_SCALE: number | null;
  IS_NULLABLE: string;
  COLUMNPROPERTY_IsIdentity: number;
};

function assertSourceIsAzureReadOnly() {
  const server = process.env.DB_SERVER || process.env.CLOUD_DB_SERVER || '';
  const db = process.env.DB_DATABASE || process.env.CLOUD_DB_NAME || '';
  if (!/\.database\.windows\.net$/i.test(server)) {
    throw new Error(`Expected Azure source for schema clone, got server=${server}`);
  }
  console.log(`[provision] SOURCE (READ-ONLY): ${server} / ${db}`);
  console.log(`[provision] DEST (WRITES): ${DEST_SERVER} / ${DEST_DB}`);
}

function sqlType(c: Col): string {
  const t = c.DATA_TYPE.toLowerCase();
  if (['varchar', 'nvarchar', 'char', 'nchar', 'varbinary'].includes(t)) {
    const len = c.CHARACTER_MAXIMUM_LENGTH;
    if (len == null || len < 0) return `${t}(MAX)`;
    return `${t}(${len})`;
  }
  if (t === 'decimal' || t === 'numeric') {
    return `${t}(${c.NUMERIC_PRECISION ?? 18},${c.NUMERIC_SCALE ?? 2})`;
  }
  if (t === 'datetime2' || t === 'time') {
    return `${t}(${c.NUMERIC_SCALE ?? 0})`;
  }
  return t;
}

async function getColumns(pool: sql.ConnectionPool, table: string): Promise<Col[]> {
  const r = await pool.request().input('t', sql.NVarChar, table).query(`
    SELECT
      c.COLUMN_NAME,
      c.DATA_TYPE,
      c.CHARACTER_MAXIMUM_LENGTH,
      c.NUMERIC_PRECISION,
      c.NUMERIC_SCALE,
      c.IS_NULLABLE,
      COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA)+'.'+QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsIdentity') AS COLUMNPROPERTY_IsIdentity
    FROM INFORMATION_SCHEMA.COLUMNS c
    WHERE c.TABLE_SCHEMA = 'dbo' AND c.TABLE_NAME = @t
    ORDER BY c.ORDINAL_POSITION
  `);
  return r.recordset as Col[];
}

async function tableExists(pool: sql.ConnectionPool, table: string): Promise<boolean> {
  const r = await pool.request().input('t', sql.NVarChar, table).query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.' + QUOTENAME(@t), N'U') IS NULL THEN 0 ELSE 1 END AS Ok
  `);
  // QUOTENAME on param wrong — use simple check
  const r2 = await pool.request().query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.[${table.replace(/]/g, '')}]', N'U') IS NULL THEN 0 ELSE 1 END AS Ok
  `);
  return Number(r2.recordset[0]?.Ok) === 1;
}

async function ensureDestDatabase() {
  // Windows auth via sqlcmd (Express is Windows-only on this machine).
  const { execFileSync } = await import('node:child_process');
  execFileSync(
    'sqlcmd',
    [
      '-S',
      DEST_SERVER,
      '-E',
      '-Q',
      `IF DB_ID(N'${DEST_DB}') IS NULL CREATE DATABASE [${DEST_DB}];`,
    ],
    { stdio: 'inherit' },
  );
  console.log(`[provision] ensured database ${DEST_DB}`);
}

async function connectDest(): Promise<sql.ConnectionPool> {
  // Prefer msnodesqlv8 Windows auth when available.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqlNative = require('mssql/msnodesqlv8') as typeof sql;
    const pool = await new sqlNative.ConnectionPool({
      server: DEST_SERVER,
      database: DEST_DB,
      driver: 'msnodesqlv8',
      options: {
        trustedConnection: true,
        trustServerCertificate: true,
        enableArithAbort: true,
      },
    } as sql.config).connect();
    console.log('[provision] dest connected via msnodesqlv8 trustedConnection');
    return pool as unknown as sql.ConnectionPool;
  } catch (e) {
    console.warn(
      '[provision] msnodesqlv8 unavailable, trying tedious without credentials',
      e instanceof Error ? e.message : e,
    );
    return new sql.ConnectionPool({
      server: DEST_SERVER,
      database: DEST_DB,
      options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
        trustedConnection: true,
      } as sql.config['options'],
    }).connect();
  }
}

async function connectSource(): Promise<sql.ConnectionPool> {
  return new sql.ConnectionPool({
    server: process.env.DB_SERVER || process.env.CLOUD_DB_SERVER || '',
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: process.env.DB_DATABASE || process.env.CLOUD_DB_NAME || '',
    user: process.env.DB_USER || process.env.CLOUD_DB_USER || '',
    password: process.env.DB_PASSWORD || process.env.CLOUD_DB_PASSWORD || '',
    options: {
      encrypt: true,
      trustServerCertificate: false,
      enableArithAbort: true,
    },
    requestTimeout: 120000,
  }).connect();
}

async function createTableFromSource(
  source: sql.ConnectionPool,
  dest: sql.ConnectionPool,
  table: string,
) {
  if (!(await tableExists(source, table))) {
    console.warn(`[provision] skip missing source table ${table}`);
    return { cols: [] as Col[], skipped: true };
  }
  const cols = await getColumns(source, table);
  if (!cols.length) {
    console.warn(`[provision] no columns for ${table}`);
    return { cols, skipped: true };
  }

  if (await tableExists(dest, table)) {
    await dest.request().query(`DROP TABLE dbo.[${table}]`);
  }

  const defs = cols.map((c) => {
    const ident = Number(c.COLUMNPROPERTY_IsIdentity) === 1 ? ' IDENTITY(1,1)' : '';
    const nullability = c.IS_NULLABLE === 'YES' ? ' NULL' : ' NOT NULL';
    return `  [${c.COLUMN_NAME}] ${sqlType(c)}${ident}${nullability}`;
  });

  // Prefer BookingID / EmpID style PK if present
  const pkCand =
    cols.find((c) => /ID$/i.test(c.COLUMN_NAME) && Number(c.COLUMNPROPERTY_IsIdentity) === 1) ||
    cols.find((c) => c.COLUMN_NAME.toLowerCase() === `${table.toLowerCase()}id`);

  let ddl = `CREATE TABLE dbo.[${table}] (\n${defs.join(',\n')}`;
  if (pkCand) {
    ddl += `,\n  CONSTRAINT [PK_${table}_iso] PRIMARY KEY ([${pkCand.COLUMN_NAME}])`;
  }
  ddl += `\n);`;

  await dest.request().query(ddl);
  return { cols, skipped: false };
}

async function copyRows(
  source: sql.ConnectionPool,
  dest: sql.ConnectionPool,
  table: string,
  cols: Col[],
  limit?: number,
) {
  const names = cols.map((c) => c.COLUMN_NAME);
  const top = limit != null ? `TOP (${limit})` : '';
  const data = await source.request().query(
    `SELECT ${top} ${names.map((n) => `[${n}]`).join(', ')} FROM dbo.[${table}]`,
  );
  const rows = data.recordset as Record<string, unknown>[];
  if (!rows.length) {
    console.log(`[provision] ${table}: 0 rows`);
    return 0;
  }

  const hasIdentity = cols.some((c) => Number(c.COLUMNPROPERTY_IsIdentity) === 1);
  if (hasIdentity) {
    await dest.request().query(`SET IDENTITY_INSERT dbo.[${table}] ON`);
  }

  let n = 0;
  for (const row of rows) {
    const req = dest.request();
    const placeholders: string[] = [];
    for (const name of names) {
      const p = `p_${name.replace(/[^a-zA-Z0-9]/g, '_')}`;
      placeholders.push(`@${p}`);
      req.input(p, row[name] as never);
    }
    await req.query(
      `INSERT INTO dbo.[${table}] (${names.map((x) => `[${x}]`).join(',')}) VALUES (${placeholders.join(',')})`,
    );
    n += 1;
  }

  if (hasIdentity) {
    await dest.request().query(`SET IDENTITY_INSERT dbo.[${table}] OFF`);
  }
  console.log(`[provision] ${table}: copied ${n} rows`);
  return n;
}

async function applyMigrations(dest: sql.ConnectionPool) {
  for (const file of V2_MIGRATIONS) {
    const p = path.join(process.cwd(), 'db/migrations', file);
    if (!fs.existsSync(p)) {
      console.warn(`[provision] migration missing ${file}`);
      continue;
    }
    const raw = fs.readFileSync(p, 'utf8');
    const batches = raw
      .split(/^\s*GO\s*$/gim)
      .map((b) => b.trim())
      .filter(Boolean);
    for (const batch of batches) {
      try {
        await dest.request().query(batch);
      } catch (e) {
        console.warn(
          `[provision] migration batch warn ${file}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }
    console.log(`[provision] applied ${file}`);
  }
}

async function writeEnvIsolated() {
  const out = path.join(process.cwd(), '.env.booking-v2-isolated');
  const body = `# AUTO-GENERATED by provision-booking-v2-isolated-db.ts
# Isolated write-test DB — NEVER point this at last132 / Azure for writes.

HAWAI_DB_CLASS=isolated
BOOKING_V2_WRITE_TEST_OK=1
BOOKING_V2_TEST_DB_SERVER=${DEST_SERVER}
BOOKING_V2_TEST_DB_NAME=${DEST_DB}

# Force app pools at local isolated DB (overrides .env.local cloud)
DB_SERVER=${DEST_SERVER}
DB_DATABASE=${DEST_DB}
DB_USER=
DB_PASSWORD=
DB_ENCRYPT=false
DB_TRUST_SERVER_CERTIFICATE=true
LOCAL_DB_SERVER=${DEST_SERVER}
LOCAL_DB_NAME=${DEST_DB}
LOCAL_DB_ENCRYPT=false
LOCAL_DB_TRUST_CERT=true

# Clear cloud aliases so getPool cannot silently hit Azure
CLOUD_DB_SERVER=
CLOUD_DB_NAME=

NODE_ENV=production
BOOKING_V2_READ_MODE=v2
BOOKING_V2_HOT_CACHE=on
BOOKING_V2_SHADOW_MODE=always
BOOKING_V2_SLOT_CLAIMS_MODE=shadow
BOOKING_V2_HOLD_POLICY_MODE=enforce
`;
  fs.writeFileSync(out, body, 'utf8');
  console.log(`[provision] wrote ${out}`);
}

async function main() {
  assertSourceIsAzureReadOnly();
  await ensureDestDatabase();

  const source = await connectSource();
  const dest = await connectDest();

  try {
    for (const table of SEED_TABLES) {
      const { cols, skipped } = await createTableFromSource(source, dest, table);
      if (skipped || !cols.length) continue;
      await copyRows(source, dest, table, cols);
    }

    for (const table of EMPTY_TABLES) {
      const { cols, skipped } = await createTableFromSource(source, dest, table);
      if (skipped || !cols.length) continue;
      console.log(`[provision] ${table}: structure only (empty)`);
    }

    await applyMigrations(dest);
    await writeEnvIsolated();

    // Sanity
    const branches = await dest.request().query(
      `SELECT BranchID, BranchCode FROM dbo.TblBranch ORDER BY BranchID`,
    );
    const emp12 = await dest
      .request()
      .query(`SELECT EmpID, EmpName FROM dbo.TblEmp WHERE EmpID = 12`);
    console.log(
      JSON.stringify(
        {
          status: 'ready',
          dest: { server: DEST_SERVER, database: DEST_DB },
          branches: branches.recordset,
          zeyad: emp12.recordset[0] || null,
          productionWrites: 0,
        },
        null,
        2,
      ),
    );
  } finally {
    await source.close();
    await dest.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env npx tsx
/**
 * Provision isolated DB using:
 *  - Azure READ-ONLY (mssql SQL auth from .env.local)
 *  - Local SQLEXPRESS via sqlcmd -E (Windows auth)
 *
 * Never mutates Azure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sql from 'mssql';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

const DEST_SERVER = process.env.BOOKING_V2_TEST_DB_SERVER || '.\\SQLEXPRESS';
const DEST_DB = process.env.BOOKING_V2_TEST_DB_NAME || 'HawaiBookingV2Isolated';
const OUT_DIR = path.join(process.cwd(), 'tmp', 'booking-v2-isolated-sql');

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
  IsIdentity: number;
};

function sqlcmd(args: string[], input?: string) {
  const opts: Parameters<typeof execFileSync>[2] = {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: input != null ? ['pipe', 'pipe', 'pipe'] : 'inherit',
  };
  if (input != null) {
    return execFileSync('sqlcmd', args, { ...opts, input }) as string;
  }
  execFileSync('sqlcmd', args, opts);
  return '';
}

function sqlType(c: Col): string {
  const t = c.DATA_TYPE.toLowerCase();
  // Widen string columns — Azure metadata + sqlcmd encoding can under-size NVARCHAR.
  if (['varchar', 'nvarchar', 'char', 'nchar'].includes(t)) {
    const base = t.startsWith('n') ? 'nvarchar' : 'nvarchar';
    const len = c.CHARACTER_MAXIMUM_LENGTH;
    if (len == null || len < 0 || len > 200) return `${base}(MAX)`;
    return `${base}(${Math.max(len * 2, 200)})`;
  }
  if (t === 'varbinary') {
    const len = c.CHARACTER_MAXIMUM_LENGTH;
    if (len == null || len < 0) return 'varbinary(MAX)';
    return `varbinary(${len})`;
  }
  if (t === 'decimal' || t === 'numeric') {
    return `${t}(${c.NUMERIC_PRECISION ?? 18},${c.NUMERIC_SCALE ?? 2})`;
  }
  if (t === 'datetime2' || t === 'time') {
    return `${t}(${c.NUMERIC_SCALE ?? 0})`;
  }
  return t;
}

function lit(v: unknown): string {
  if (v == null) return 'NULL';
  if (v instanceof Date) {
    const iso = v.toISOString();
    return `CONVERT(datetime2, '${iso.slice(0, 23)}', 126)`;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'object' && Buffer.isBuffer(v)) {
    return `0x${v.toString('hex')}`;
  }
  const s = String(v).replace(/'/g, "''");
  return `N'${s}'`;
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
      ISNULL(COLUMNPROPERTY(OBJECT_ID('dbo.' + @t), c.COLUMN_NAME, 'IsIdentity'), 0) AS IsIdentity
    FROM INFORMATION_SCHEMA.COLUMNS c
    WHERE c.TABLE_SCHEMA = 'dbo' AND c.TABLE_NAME = @t
    ORDER BY c.ORDINAL_POSITION
  `);
  return r.recordset as Col[];
}

async function sourceHasTable(pool: sql.ConnectionPool, table: string): Promise<boolean> {
  const r = await pool.request().input('t', sql.NVarChar, table).query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.' + @t, N'U') IS NULL THEN 0 ELSE 1 END AS Ok
  `);
  return Number(r.recordset[0]?.Ok) === 1;
}

function buildCreateSql(table: string, cols: Col[]): string {
  const defs = cols.map((c) => {
    const ident = Number(c.IsIdentity) === 1 ? ' IDENTITY(1,1)' : '';
    const nullability = c.IS_NULLABLE === 'YES' ? ' NULL' : ' NOT NULL';
    return `  [${c.COLUMN_NAME}] ${sqlType(c)}${ident}${nullability}`;
  });
  const pk =
    cols.find((c) => Number(c.IsIdentity) === 1) ||
    cols.find((c) => c.COLUMN_NAME.toLowerCase().endsWith('id'));
  let ddl = `IF OBJECT_ID(N'dbo.[${table}]', N'U') IS NOT NULL DROP TABLE dbo.[${table}];\n`;
  ddl += `CREATE TABLE dbo.[${table}] (\n${defs.join(',\n')}`;
  if (pk) ddl += `,\n  CONSTRAINT [PK_${table}_iso] PRIMARY KEY ([${pk.COLUMN_NAME}])`;
  ddl += `\n);\nGO\n`;
  return ddl;
}

async function main() {
  const srcServer = process.env.DB_SERVER || process.env.CLOUD_DB_SERVER || '';
  const srcDb = process.env.DB_DATABASE || process.env.CLOUD_DB_NAME || '';
  if (!/\.database\.windows\.net$/i.test(srcServer)) {
    throw new Error(`Expected Azure read source, got ${srcServer}`);
  }
  if (srcDb.toLowerCase() === DEST_DB.toLowerCase()) {
    throw new Error('Refusing: dest DB name equals source');
  }

  console.log(`[provision] SOURCE READ-ONLY ${srcServer}/${srcDb}`);
  console.log(`[provision] DEST WRITE ${DEST_SERVER}/${DEST_DB}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  sqlcmd(['-S', DEST_SERVER, '-E', '-Q', `IF DB_ID(N'${DEST_DB}') IS NULL CREATE DATABASE [${DEST_DB}];`]);

  const source = await new sql.ConnectionPool({
    server: srcServer,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database: srcDb,
    user: process.env.DB_USER || process.env.CLOUD_DB_USER || '',
    password: process.env.DB_PASSWORD || process.env.CLOUD_DB_PASSWORD || '',
    options: { encrypt: true, trustServerCertificate: false, enableArithAbort: true },
    requestTimeout: 180000,
  }).connect();

  try {
    const parts: string[] = ['SET NOCOUNT ON;\n'];

    for (const table of [...SEED_TABLES, ...EMPTY_TABLES]) {
      if (!(await sourceHasTable(source, table))) {
        console.warn(`[provision] skip missing ${table}`);
        continue;
      }
      const cols = await getColumns(source, table);
      parts.push(buildCreateSql(table, cols));

      const isEmpty = EMPTY_TABLES.includes(table);
      if (isEmpty) {
        console.log(`[provision] ${table}: structure only`);
        continue;
      }

      const names = cols.map((c) => c.COLUMN_NAME);
      const data = await source
        .request()
        .query(`SELECT ${names.map((n) => `[${n}]`).join(',')} FROM dbo.[${table}]`);
      const rows = data.recordset as Record<string, unknown>[];
      const hasIdentity = cols.some((c) => Number(c.IsIdentity) === 1);
      if (hasIdentity) parts.push(`SET IDENTITY_INSERT dbo.[${table}] ON;\n`);
      for (const row of rows) {
        parts.push(
          `INSERT INTO dbo.[${table}] (${names.map((n) => `[${n}]`).join(',')}) VALUES (${names
            .map((n) => lit(row[n]))
            .join(',')});\n`,
        );
      }
      if (hasIdentity) parts.push(`SET IDENTITY_INSERT dbo.[${table}] OFF;\n`);
      parts.push('GO\n');
      console.log(`[provision] ${table}: ${rows.length} rows scripted`);
    }

    const scriptPath = path.join(OUT_DIR, '01-seed.sql');
    fs.writeFileSync(scriptPath, parts.join(''), { encoding: 'utf8' });
    console.log(`[provision] executing ${scriptPath}`);
    // UTF-8 in/out so Arabic NVARCHAR literals survive.
    sqlcmd(['-S', DEST_SERVER, '-E', '-d', DEST_DB, '-f', '65001', '-i', scriptPath]);

    for (const file of V2_MIGRATIONS) {
      const p = path.join(process.cwd(), 'db/migrations', file);
      if (!fs.existsSync(p)) continue;
      console.log(`[provision] migration ${file}`);
      try {
        // Filtered indexes need QUOTED_IDENTIFIER ON (sqlcmd defaults can break CREATE INDEX).
        const wrapped = path.join(OUT_DIR, `mig-${file}`);
        const body = fs.readFileSync(p, 'utf8');
        fs.writeFileSync(
          wrapped,
          `SET QUOTED_IDENTIFIER ON;\nSET ANSI_NULLS ON;\nGO\n${body}\n`,
          'utf8',
        );
        sqlcmd(['-S', DEST_SERVER, '-E', '-d', DEST_DB, '-i', wrapped]);
      } catch (e) {
        console.warn(`[provision] migration warn ${file}`, e instanceof Error ? e.message : e);
      }
    }

    const check = sqlcmd([
      '-S',
      DEST_SERVER,
      '-E',
      '-d',
      DEST_DB,
      '-h',
      '-1',
      '-W',
      '-Q',
      `SET NOCOUNT ON; SELECT BranchCode FROM dbo.TblBranch; SELECT EmpID, EmpName FROM dbo.TblEmp WHERE EmpID=12;`,
    ]);
    console.log(check);

    const envPath = path.join(process.cwd(), '.env.booking-v2-isolated');
    // App needs SQL auth OR we document Windows-only via msnodesqlv8.
    // For now write LOCAL_* and a note; also set a connection string for sqlcmd harnesses.
    fs.writeFileSync(
      envPath,
      `# Isolated Booking V2 write-test environment
HAWAI_DB_CLASS=isolated
BOOKING_V2_WRITE_TEST_OK=1
BOOKING_V2_TEST_DB_SERVER=${DEST_SERVER}
BOOKING_V2_TEST_DB_NAME=${DEST_DB}

# Point BOTH local and default DB vars at isolated Express DB.
# Next.js mssql driver: use trusted connection via msnodesqlv8 when user/password empty.
DB_SERVER=${DEST_SERVER}
DB_DATABASE=${DEST_DB}
DB_USER=
DB_PASSWORD=
DB_ENCRYPT=false
DB_TRUST_SERVER_CERTIFICATE=true
LOCAL_DB_SERVER=${DEST_SERVER}
LOCAL_DB_NAME=${DEST_DB}
LOCAL_DB_USER=
LOCAL_DB_PASSWORD=
LOCAL_DB_ENCRYPT=false
LOCAL_DB_TRUST_CERT=true
CLOUD_DB_SERVER=
CLOUD_DB_NAME=
CLOUD_DB_USER=
CLOUD_DB_PASSWORD=

BOOKING_V2_USE_TRUSTED_CONNECTION=1

NODE_ENV=production
BOOKING_V2_READ_MODE=v2
BOOKING_V2_HOT_CACHE=on
BOOKING_V2_SHADOW_MODE=always
BOOKING_V2_SLOT_CLAIMS_MODE=shadow
BOOKING_V2_HOLD_POLICY_MODE=enforce
`,
      'utf8',
    );
    console.log(`[provision] wrote ${envPath}`);
    console.log(JSON.stringify({ status: 'ready', destDb: DEST_DB, productionWrites: 0 }, null, 2));
  } finally {
    await source.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

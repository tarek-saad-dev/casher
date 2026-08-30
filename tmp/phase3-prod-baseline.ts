#!/usr/bin/env npx tsx
/**
 * Phase 3 prod canary: baseline + post-migration verify (read-only counts).
 * Run on VPS from /home/casher/app with production .env.local
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

const appRoot = process.env.CASHER_APP_ROOT || process.cwd();
dotenv.config({ path: path.join(appRoot, '.env') });
dotenv.config({ path: path.join(appRoot, '.env.local'), override: true });

const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const orig = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return orig.call(this, r, ...rest);
};

async function countOrNeg(pool: any, sqlText: string): Promise<number> {
  try {
    const r = await pool.request().query(sqlText);
    return Number(r.recordset[0]?.c ?? -1);
  } catch {
    return -1;
  }
}

async function main() {
  const label = process.argv[2] || 'baseline';
  const { getPool, closePool, getCurrentDbTarget, getDbConnectionInfo } = await import(
    path.join(appRoot, 'src/lib/db.ts')
  );
  const target = getCurrentDbTarget();
  const info = getDbConnectionInfo();
  const resolved = target === 'local' ? info.local : info.cloud;
  console.log(
    JSON.stringify(
      {
        label,
        target,
        server: resolved.server,
        port: (resolved as { port?: number }).port ?? null,
        database: resolved.database,
      },
      null,
      2,
    ),
  );

  const pool = await getPool();
  const oid = await pool.request().query(`
    SELECT OBJECT_ID(N'dbo.TblBotBookingPlan') AS oid
  `);

  const counts = {
    conversations: await countOrNeg(pool, 'SELECT COUNT(*) AS c FROM dbo.TblBotConversation'),
    messages: await countOrNeg(pool, 'SELECT COUNT(*) AS c FROM dbo.TblBotMessage'),
    aiTurns: await countOrNeg(pool, 'SELECT COUNT(*) AS c FROM dbo.TblBotAiTurn'),
    outbox: await countOrNeg(pool, 'SELECT COUNT(*) AS c FROM dbo.TblMessageOutbox'),
    bookingPlanOid: oid.recordset[0]?.oid ?? null,
    bookingPlans: oid.recordset[0]?.oid
      ? await countOrNeg(pool, 'SELECT COUNT(*) AS c FROM dbo.TblBotBookingPlan')
      : 0,
    holds: await countOrNeg(pool, 'SELECT COUNT(*) AS c FROM dbo.TblBookingHold'),
    holdsAlt: await countOrNeg(pool, 'SELECT COUNT(*) AS c FROM dbo.BookingHold'),
    claims: await countOrNeg(
      pool,
      `SELECT COUNT(*) AS c FROM sys.tables t WHERE 1=0`,
    ),
    slotClaims: await countOrNeg(
      pool,
      `SELECT COUNT(*) AS c FROM dbo.TblBookingSlotClaim`,
    ),
    publicCreateReqs: await countOrNeg(
      pool,
      `SELECT COUNT(*) AS c FROM dbo.TblPublicBookingCreateRequest`,
    ),
    publicCreateReqsAlt: await countOrNeg(
      pool,
      `SELECT COUNT(*) AS c FROM dbo.PublicBookingCreateRequest`,
    ),
    bookings: await countOrNeg(pool, 'SELECT COUNT(*) AS c FROM dbo.TblBooking'),
    bookingsAlt: await countOrNeg(pool, 'SELECT COUNT(*) AS c FROM dbo.TblBookings'),
  };

  // Probe claim/create table names if unknowns
  const nameProbe = await pool.request().query(`
    SELECT name FROM sys.tables
    WHERE name LIKE N'%Hold%'
       OR name LIKE N'%Claim%'
       OR name LIKE N'%PublicBooking%'
       OR name LIKE N'%Booking%'
    ORDER BY name
  `);

  console.log(JSON.stringify({ counts, bookingRelatedTables: nameProbe.recordset.map((r: { name: string }) => r.name) }, null, 2));
  await closePool();
}

main().catch((e) => {
  console.error('FAIL', e instanceof Error ? e.message : e);
  process.exit(2);
});

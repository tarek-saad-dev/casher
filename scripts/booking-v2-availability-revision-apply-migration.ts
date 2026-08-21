/**
 * Apply create-booking-availability-revision.sql if table missing (deploy-time only).
 * Usage: npx tsx scripts/booking-v2-availability-revision-apply-migration.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

async function main() {
  const { getPool, sql } = await import('../src/lib/db');
  const db = await getPool();

  const exists = await db.request().query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.TblBookingAvailabilityRevision', N'U') IS NULL
      THEN 0 ELSE 1 END AS Ok
  `);
  if (Number(exists.recordset[0]?.Ok) === 1) {
    console.log(JSON.stringify({ status: 'already_ready' }, null, 2));
    process.exit(0);
  }

  const sqlPath = path.join(
    process.cwd(),
    'db/migrations/create-booking-availability-revision.sql',
  );
  const raw = fs.readFileSync(sqlPath, 'utf8');
  const batches = raw
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter(Boolean);

  for (const batch of batches) {
    await db.request().query(batch);
  }

  const after = await db.request().query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.TblBookingAvailabilityRevision', N'U') IS NULL
      THEN 0 ELSE 1 END AS Ok
  `);
  const ready = Number(after.recordset[0]?.Ok) === 1;
  console.log(JSON.stringify({ status: ready ? 'applied' : 'failed', ready }, null, 2));
  process.exit(ready ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

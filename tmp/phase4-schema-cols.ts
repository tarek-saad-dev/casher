#!/usr/bin/env npx tsx
import Module from 'module';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', override: true });
const mod = Module as any;
const o = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};
async function main() {
  const { getPool, closePool } = await import('./src/lib/db.ts');
  const pool = await getPool();
  for (const t of ['TblBookingSlotClaim', 'Bookings', 'TblPublicBookingCreateRequest']) {
    const cols = await pool.request().query(`
      SELECT c.name FROM sys.columns c
      WHERE c.object_id = OBJECT_ID(N'dbo.${t}')
      ORDER BY c.column_id
    `);
    console.log(t, cols.recordset.map((x: any) => x.name).join(','));
  }
  await closePool();
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});

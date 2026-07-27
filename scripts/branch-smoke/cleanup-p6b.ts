/** Emergency cleanup P6B leftovers */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const o = m._load;
m._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};
async function main() {
  const { setDbTarget, getPool } = await import('../../src/lib/db');
  await setDbTarget('cloud');
  const db = await getPool();
  const before = await db.request().query(`
    SELECT COUNT(*) AS cnt FROM dbo.Bookings WHERE Notes LIKE N'%P6B%'
  `);
  await db.request().query(`
    DECLARE @ids TABLE (id INT);
    INSERT INTO @ids SELECT BookingID FROM dbo.Bookings WHERE Notes LIKE N'%P6B%';
    DELETE bs FROM dbo.BookingServices bs INNER JOIN @ids i ON i.id = bs.BookingID;
    DELETE b FROM dbo.Bookings b INNER JOIN @ids i ON i.id = b.BookingID;
    DELETE FROM dbo.TblPublicBookingCreateRequest WHERE IdempotencyKey LIKE N'P6B-%';
  `);
  const after = await db.request().query(`
    SELECT COUNT(*) AS cnt FROM dbo.Bookings WHERE Notes LIKE N'%P6B%'
  `);
  console.log({ before: before.recordset[0].cnt, after: after.recordset[0].cnt });
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

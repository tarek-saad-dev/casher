/**
 * Read-only: confirm no booking claim/hold created for this phone around the window.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

const appRoot = '/home/casher/app';
dotenv.config({ path: path.join(appRoot, '.env.local'), override: true });
const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const orig = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return orig.call(this, r, ...rest);
};

async function main() {
  const { getPool, closePool } = await import(path.join(appRoot, 'src/lib/db.ts'));
  const pool = await getPool();

  // Idempotency uniqueness for those outbox keys
  const idem = await pool.request().query(`
    SELECT IdempotencyKey, COUNT(*) AS cnt
    FROM dbo.TblMessageOutbox
    WHERE IdempotencyKey IN (
      N'whatsapp-bot-ai-turn:21',
      N'whatsapp-bot-ai-turn:22',
      N'whatsapp-bot-ai-turn:23'
    )
    GROUP BY IdempotencyKey
  `);
  console.log('OUTBOX_IDEM', JSON.stringify(idem.recordset, null, 2));

  // Recent booking holds/claims near window — inspect schemas first
  for (const table of [
    'TblBookingSlotClaim',
    'TblBookingHold',
    'TblPublicBookingCreateRequest',
    'Bookings',
  ]) {
    const cols = await pool.request().query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = '${table}' ORDER BY ORDINAL_POSITION
    `);
    console.log(`COLS_${table}`, cols.recordset.map((r: any) => r.COLUMN_NAME).join(','));
  }

  // Probe phone-like columns around window
  const claims = await pool.request().query(`
    SELECT TOP 20 *
    FROM dbo.TblBookingSlotClaim
    WHERE CreatedAt >= '2026-08-29T10:50:00' AND CreatedAt < '2026-08-29T11:10:00'
    ORDER BY CreatedAt DESC
  `).catch((e: any) => ({ recordset: [], error: String(e?.message || e) }));
  console.log('CLAIMS_WINDOW', JSON.stringify(claims, null, 2).slice(0, 4000));

  const holds = await pool.request().query(`
    SELECT TOP 20 *
    FROM dbo.TblBookingHold
    WHERE CreatedAt >= '2026-08-29T10:50:00' AND CreatedAt < '2026-08-29T11:10:00'
    ORDER BY CreatedAt DESC
  `).catch((e: any) => ({ recordset: [], error: String(e?.message || e) }));
  console.log('HOLDS_WINDOW', JSON.stringify(holds, null, 2).slice(0, 4000));

  const pubs = await pool.request().query(`
    SELECT TOP 20 *
    FROM dbo.TblPublicBookingCreateRequest
    WHERE CreatedAt >= '2026-08-29T10:50:00' AND CreatedAt < '2026-08-29T11:10:00'
    ORDER BY CreatedAt DESC
  `).catch((e: any) => ({ recordset: [], error: String(e?.message || e) }));
  console.log('PUBLIC_CREATE_WINDOW', JSON.stringify(pubs, null, 2).slice(0, 4000));

  await closePool();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

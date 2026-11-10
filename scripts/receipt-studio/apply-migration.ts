import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { getPool } from '../../src/lib/db';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const backedUp = args.has('--backup-verified');
const target = String(process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || process.env.DB_NAME || '').trim();

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

async function main() {
  const file = path.join(process.cwd(), 'db', 'migrations', 'receipt-studio-v1.sql');
  const text = fs.readFileSync(file, 'utf8');
  const dbName = String(process.env.CLOUD_DB_NAME || process.env.DB_DATABASE || process.env.DB_NAME || '<configured database>');
  console.log('[receipt-studio migration]', { database: dbName, mode: apply ? 'APPLY' : 'PLAN', bytes: text.length });
  if (!apply) {
    console.log('PLAN ONLY: No SQL has run. To apply after verifying a backup:');
    console.log('npx tsx scripts/receipt-studio/apply-migration.ts --apply --backup-verified');
    return;
  }
  if (!backedUp) throw new Error('Refusing to change DB without --backup-verified');
  const db = await getPool();
  const existing = await db.request().query(`
    SELECT DB_NAME() AS db, OBJECT_ID(N'dbo.ReceiptStudioTemplate', N'U') AS templateTable
  `);
  console.log('[receipt-studio migration] connection:', existing.recordset[0]?.db);
  await db.request().batch(text);
  const result = await db.request().query(`
    SELECT CASE WHEN
      OBJECT_ID(N'dbo.ReceiptStudioTemplate', N'U') IS NOT NULL AND
      OBJECT_ID(N'dbo.ReceiptStudioVersion', N'U') IS NOT NULL AND
      OBJECT_ID(N'dbo.ReceiptStudioAsset', N'U') IS NOT NULL
      THEN 1 ELSE 0 END AS Ready
  `);
  if (result.recordset[0]?.Ready !== 1) throw new Error('Schema verification failed');
  console.log('OK: Receipt Studio SQL schema is installed and verified. No live invoice design was activated.');
}
main().then(() => process.exit(0)).catch((error) => {
  console.error('[receipt-studio migration] FAILED:', error);
  process.exit(1);
});

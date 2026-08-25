#!/usr/bin/env npx tsx
/**
 * Apply db/migrations/seed-whatsapp-templates-phase6.sql (idempotent).
 * Never prints secrets.
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

async function main() {
  const { getPool, getDbConnectionInfo, getCurrentDbTarget, closePool } = await import(
    '../src/lib/db'
  );

  const target = getCurrentDbTarget();
  const info = getDbConnectionInfo();
  const resolved = target === 'local' ? info.local : info.cloud;
  console.log('phase6 whatsapp template seed');
  console.log(`  runtime target: ${target}`);
  console.log(`  server: ${resolved.server}`);
  console.log(`  database: ${resolved.database}`);

  const pool = await getPool();
  const text = fs.readFileSync(
    path.join(__dirname, '..', 'db/migrations/seed-whatsapp-templates-phase6.sql'),
    'utf8',
  );
  const batches = text.split(/^\s*GO\s*$/gim).map((b) => b.trim()).filter(Boolean);
  console.log('batches', batches.length);

  for (let i = 0; i < batches.length; i++) {
    console.log('running batch', i + 1);
    await pool.request().batch(batches[i]);
  }

  const check = await pool.request().query(`
    SELECT t.TemplateKey, t.BranchID, t.IsActive, t.Version
    FROM dbo.TblMessageTemplate t
    WHERE t.Channel = N'whatsapp'
      AND t.Language = N'ar'
      AND t.BranchID IS NULL
      AND t.TemplateKey IN (
        N'customer.first_time',
        N'sale.employee_notification',
        N'booking.confirmation',
        N'employee.advance',
        N'employee.funding',
        N'attendance.check_in',
        N'attendance.check_out',
        N'employee.daily_report',
        N'owner.daily_report',
        N'sale.customer_receipt'
      )
    ORDER BY t.TemplateKey
  `);
  console.table(check.recordset);

  for (let i = 0; i < batches.length; i++) {
    await pool.request().batch(batches[i]);
  }
  console.log('Idempotent re-run OK; global seeded keys', check.recordset.length);
  await closePool();
}

main().catch((e) => {
  const message = e instanceof Error ? e.message : String(e);
  const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
  console.error('seed failed', code || '', message);
  process.exit(1);
});

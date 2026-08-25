#!/usr/bin/env npx tsx
/**
 * Apply Phase 7 WhatsApp campaign tables + employee.tip seed (idempotent).
 * Never prints secrets.
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

async function applyBatches(pool: Awaited<ReturnType<typeof import('../src/lib/db')['getPool']>>, filePath: string) {
  const text = fs.readFileSync(filePath, 'utf8');
  const batches = text.split(/^\s*GO\s*$/gim).map((b) => b.trim()).filter(Boolean);
  for (const batch of batches) {
    await pool.request().batch(batch);
  }
  return batches.length;
}

async function main() {
  const { getPool, getDbConnectionInfo, getCurrentDbTarget, closePool } = await import(
    '../src/lib/db'
  );

  const target = getCurrentDbTarget();
  const info = getDbConnectionInfo();
  const resolved = target === 'local' ? info.local : info.cloud;
  console.log('phase7 whatsapp campaign migration');
  console.log(`  runtime target: ${target}`);
  console.log(`  server: ${resolved.server}`);
  console.log(`  database: ${resolved.database}`);

  const pool = await getPool();
  const root = path.join(__dirname, '..');

  const campaignPath = path.join(root, 'db/migrations/create-tbl-whatsapp-campaign.sql');
  const seedPath = path.join(root, 'db/migrations/seed-whatsapp-templates-phase7.sql');

  const campaignBatches = await applyBatches(pool, campaignPath);
  console.log('campaign table batches', campaignBatches);

  const seedBatches = await applyBatches(pool, seedPath);
  console.log('phase7 seed batches', seedBatches);

  const tables = await pool.request().query(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME IN (N'TblWhatsAppCampaign', N'TblWhatsAppCampaignRecipient')
    ORDER BY TABLE_NAME
  `);
  console.table(tables.recordset);

  const tipSeed = await pool.request().query(`
    SELECT t.TemplateKey, t.BranchID, t.IsActive, t.Version
    FROM dbo.TblMessageTemplate t
    WHERE t.Channel = N'whatsapp'
      AND t.Language = N'ar'
      AND t.BranchID IS NULL
      AND t.TemplateKey = N'employee.tip'
  `);
  console.table(tipSeed.recordset);

  await applyBatches(pool, campaignPath);
  await applyBatches(pool, seedPath);
  console.log('Idempotent re-run OK');
  await closePool();
}

main().catch((e) => {
  const message = e instanceof Error ? e.message : String(e);
  const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
  console.error('migration failed', code || '', message);
  process.exit(1);
});

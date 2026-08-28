#!/usr/bin/env npx tsx
/**
 * Apply db/migrations/create-tbl-message-inbox.sql to the same DB
 * Casher runtime uses (getPool target). Then prove ingest idempotency.
 * Never prints secrets. Does not process or reply to messages.
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

const TEST_PROVIDER = 'whatsapp-web';
const TEST_PROVIDER_MESSAGE_ID = 'phase1-migration-test-001';

async function runSqlBatches(
  pool: { request: () => { batch: (sql: string) => Promise<unknown> } },
  batches: string[],
) {
  for (let i = 0; i < batches.length; i++) {
    console.log('running batch', i + 1);
    await pool.request().batch(batches[i]);
  }
}

async function main() {
  const { getPool, getDbConnectionInfo, getCurrentDbTarget, closePool } = await import(
    '../src/lib/db'
  );

  const target = getCurrentDbTarget();
  const info = getDbConnectionInfo();
  const resolved = target === 'local' ? info.local : info.cloud;
  console.log('message-inbox migration');
  console.log(`  runtime target: ${target}`);
  console.log(`  server: ${resolved.server}`);
  console.log(`  database: ${resolved.database}`);
  console.log(`  migration: create-tbl-message-inbox.sql`);

  const pool = await getPool();
  const text = fs.readFileSync(
    path.join(__dirname, '..', 'db/migrations/create-tbl-message-inbox.sql'),
    'utf8',
  );
  const batches = text.split(/^\s*GO\s*$/gim).map((b) => b.trim()).filter(Boolean);
  console.log('batches', batches.length);

  console.log('--- first apply ---');
  await runSqlBatches(pool, batches);

  const table = await pool.request().query(`
    SELECT OBJECT_ID(N'dbo.TblMessageInbox', N'U') AS objectId
  `);
  if (!table.recordset[0]?.objectId) {
    throw new Error('TblMessageInbox was not created');
  }
  console.log('TblMessageInbox objectId', table.recordset[0].objectId);

  console.log('--- second apply (idempotency) ---');
  await runSqlBatches(pool, batches);
  console.log('Idempotent re-run OK');

  const { ingestIncomingMessage } = await import(
    '../src/modules/messaging/inbox/application/ingestIncomingMessage'
  );
  const { countByProviderMessage } = await import(
    '../src/modules/messaging/inbox/infra/messageInboxRepository'
  );

  await pool
    .request()
    .input('provider', TEST_PROVIDER)
    .input('providerMessageId', TEST_PROVIDER_MESSAGE_ID)
    .query(`
      DELETE FROM dbo.TblMessageInbox
      WHERE Provider = @provider AND ProviderMessageID = @providerMessageId
    `);

  const first = await ingestIncomingMessage({
    provider: TEST_PROVIDER,
    providerMessageId: TEST_PROVIDER_MESSAGE_ID,
    phone: '201000000001',
    chatTitle: 'Migration Test',
    messageType: 'text',
    text: 'phase1 migration probe',
    isGroup: false,
    receivedAt: new Date().toISOString(),
    rawPayload: { source: 'phase1.migration' },
  });
  const second = await ingestIncomingMessage({
    provider: TEST_PROVIDER,
    providerMessageId: TEST_PROVIDER_MESSAGE_ID,
    phone: '201000000001',
    chatTitle: 'Migration Test',
    messageType: 'text',
    text: 'phase1 migration probe duplicate',
    isGroup: false,
    receivedAt: new Date().toISOString(),
    rawPayload: { source: 'phase1.migration' },
  });

  const count = await countByProviderMessage(TEST_PROVIDER, TEST_PROVIDER_MESSAGE_ID);

  console.log('live ingest first', first);
  console.log('live ingest second', second);
  console.log('live row count', count);

  if (first.duplicate !== false || first.inboxId <= 0) {
    throw new Error('First ingest did not create a new inbox row');
  }
  if (!second.duplicate || second.inboxId !== first.inboxId) {
    throw new Error('Second ingest was not treated as a duplicate of the same row');
  }
  if (count !== 1) {
    throw new Error('Expected exactly one inbox row for the test provider message id');
  }

  await pool
    .request()
    .input('provider', TEST_PROVIDER)
    .input('providerMessageId', TEST_PROVIDER_MESSAGE_ID)
    .query(`
      DELETE FROM dbo.TblMessageInbox
      WHERE Provider = @provider AND ProviderMessageID = @providerMessageId
    `);
  console.log('deleted test row', TEST_PROVIDER_MESSAGE_ID);

  await closePool();
  console.log('Phase 1 message inbox live verification OK');
}

main().catch((e) => {
  const message = e instanceof Error ? e.message : String(e);
  const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
  console.error('migration failed', code || '', message);
  process.exit(1);
});

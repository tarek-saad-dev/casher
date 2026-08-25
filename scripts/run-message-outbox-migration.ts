#!/usr/bin/env npx tsx
/**
 * Apply db/migrations/create-tbl-message-outbox.sql to the same DB
 * Casher runtime uses (getPool target). Then prove enqueue idempotency.
 * Never prints secrets. Does not send WhatsApp.
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

const TEST_IDEMPOTENCY_KEY = 'outbox:phase5a:test';
const TEST_CONTENT = '[OUTBOX-5A-TEST]';

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
  console.log('message-outbox migration');
  console.log(`  runtime target: ${target}`);
  console.log(`  server: ${resolved.server}`);
  console.log(`  database: ${resolved.database}`);
  console.log(`  migration: create-tbl-message-outbox.sql`);

  const pool = await getPool();
  const text = fs.readFileSync(
    path.join(__dirname, '..', 'db/migrations/create-tbl-message-outbox.sql'),
    'utf8',
  );
  const batches = text.split(/^\s*GO\s*$/gim).map((b) => b.trim()).filter(Boolean);
  console.log('batches', batches.length);

  console.log('--- first apply ---');
  await runSqlBatches(pool, batches);

  const who = await pool.request().query(`
    SELECT DB_NAME() AS dbName, @@SERVERNAME AS serverName
  `);
  console.log('connected dbName', who.recordset[0]?.dbName);
  console.log('connected serverName', who.recordset[0]?.serverName);

  const table = await pool.request().query(`
    SELECT OBJECT_ID(N'dbo.TblMessageOutbox', N'U') AS objectId
  `);
  if (!table.recordset[0]?.objectId) {
    throw new Error('TblMessageOutbox was not created');
  }
  console.log('TblMessageOutbox objectId', table.recordset[0].objectId);

  const cols = await pool.request().query(`
    SELECT c.name AS columnName, t.name AS typeName, c.max_length, c.is_nullable
    FROM sys.columns c
    JOIN sys.types t ON t.user_type_id = c.user_type_id
    WHERE c.object_id = OBJECT_ID(N'dbo.TblMessageOutbox')
    ORDER BY c.column_id
  `);
  console.table(cols.recordset);

  const constraints = await pool.request().query(`
    SELECT name, type_desc
    FROM sys.objects
    WHERE parent_object_id = OBJECT_ID(N'dbo.TblMessageOutbox')
    ORDER BY type_desc, name
  `);
  console.log('constraints/indexes objects');
  console.table(constraints.recordset);

  console.log('--- second apply (idempotency) ---');
  await runSqlBatches(pool, batches);
  console.log('Idempotent re-run OK');

  const { enqueueMessage } = await import('../src/modules/messaging/application/enqueueMessage');

  await pool.request()
    .input('key', TEST_IDEMPOTENCY_KEY)
    .query(`DELETE FROM dbo.TblMessageOutbox WHERE IdempotencyKey = @key`);

  const first = await enqueueMessage({
    channel: 'whatsapp',
    recipient: { phone: '00000000000' },
    content: { text: TEST_CONTENT },
    templateKey: 'phase5a.test',
    metadata: { source: 'phase5a.live', marker: TEST_CONTENT },
    idempotencyKey: TEST_IDEMPOTENCY_KEY,
  });
  const second = await enqueueMessage({
    channel: 'whatsapp',
    recipient: { phone: '00000000000' },
    content: { text: TEST_CONTENT },
    templateKey: 'phase5a.test',
    metadata: { source: 'phase5a.live', marker: TEST_CONTENT },
    idempotencyKey: TEST_IDEMPOTENCY_KEY,
  });

  const count = await pool.request()
    .input('key', TEST_IDEMPOTENCY_KEY)
    .query(`
      SELECT COUNT(*) AS cnt, MAX(Content) AS content, MAX(Status) AS status
      FROM dbo.TblMessageOutbox
      WHERE IdempotencyKey = @key
    `);

  console.log('live enqueue first', first);
  console.log('live enqueue second', second);
  console.log('live row count', count.recordset[0]);

  if (!first.queued || first.duplicate !== false || first.status !== 'pending') {
    throw new Error('First enqueue did not create a pending row');
  }
  if (!second.duplicate || second.messageId !== first.messageId) {
    throw new Error('Second enqueue was not treated as a duplicate of the same row');
  }
  if (Number(count.recordset[0]?.cnt) !== 1) {
    throw new Error('Expected exactly one outbox row for the test idempotency key');
  }
  if (String(count.recordset[0]?.content) !== TEST_CONTENT) {
    throw new Error('Rendered content snapshot was not stored literally');
  }

  await pool.request()
    .input('key', TEST_IDEMPOTENCY_KEY)
    .query(`DELETE FROM dbo.TblMessageOutbox WHERE IdempotencyKey = @key`);
  console.log('deleted test row', TEST_IDEMPOTENCY_KEY);

  await closePool();
  console.log('Phase 5A live outbox verification OK');
}

main().catch((e) => {
  const message = e instanceof Error ? e.message : String(e);
  const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
  console.error('migration failed', code || '', message);
  process.exit(1);
});

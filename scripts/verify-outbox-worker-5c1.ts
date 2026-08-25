#!/usr/bin/env npx tsx
/**
 * Phase 5C1 live check: enqueue snapshot, run the outbox worker once, replay same key.
 * Uses WHATSAPP_E2E_TEST_PHONE only. Does not change Sale / Quick Message.
 */
import path from 'path';
import { spawn } from 'child_process';
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

const KEY = 'outbox:phase5c1:e2e';
const CONTENT = '[OUTBOX-WORKER-5C1]';

function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****';
  return `${phone.slice(0, 3)}****${phone.slice(-2)}`;
}

function runWorkerOnce(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx tsx scripts/messaging-outbox-worker.ts --once', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
      shell: true,
      env: process.env,
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`worker --once exited ${code}`));
    });
    child.on('error', reject);
  });
}

async function main() {
  const phone = String(process.env.WHATSAPP_E2E_TEST_PHONE ?? '').trim();
  if (!phone) {
    throw new Error('WHATSAPP_E2E_TEST_PHONE is required');
  }

  const { getPool, closePool } = await import('../src/lib/db');
  const { enqueueMessage } = await import('../src/modules/messaging/application/enqueueMessage');
  const { getByIdempotencyKey } = await import(
    '../src/modules/messaging/outbox/messageOutboxRepository'
  );

  const pool = await getPool();
  await pool.request().input('key', KEY).query(
    `DELETE FROM dbo.TblMessageOutbox WHERE IdempotencyKey = @key`,
  );

  console.log('enqueue 1', { phone: maskPhone(phone), key: KEY, content: CONTENT });
  const first = await enqueueMessage({
    channel: 'whatsapp',
    recipient: { phone },
    content: { text: CONTENT },
    templateKey: 'phase5c1.e2e',
    metadata: { source: 'phase5c1.e2e' },
    idempotencyKey: KEY,
  });
  console.log('enqueue 1 result', first);

  await runWorkerOnce();

  const afterSend = await getByIdempotencyKey(KEY);
  console.log('after worker', {
    status: afterSend?.status,
    attemptCount: afterSend?.attemptCount,
    providerMessageId: afterSend?.providerMessageId,
    lockedBy: afterSend?.lockedBy,
    content: afterSend?.content,
  });
  if (afterSend?.status !== 'sent' || !afterSend.providerMessageId) {
    throw new Error(`Expected sent with ProviderMessageID, got ${afterSend?.status}`);
  }

  const second = await enqueueMessage({
    channel: 'whatsapp',
    recipient: { phone },
    content: { text: CONTENT },
    templateKey: 'phase5c1.e2e',
    metadata: { source: 'phase5c1.e2e' },
    idempotencyKey: KEY,
  });
  console.log('enqueue 2 result', second);
  if (!second.duplicate || second.messageId !== first.messageId) {
    throw new Error('Second enqueue must be a duplicate of the same row');
  }

  await runWorkerOnce();
  const afterReplay = await getByIdempotencyKey(KEY);
  const count = await pool.request().input('key', KEY).query(
    `SELECT COUNT(*) AS cnt FROM dbo.TblMessageOutbox WHERE IdempotencyKey = @key`,
  );
  console.log('after replay', {
    status: afterReplay?.status,
    providerMessageId: afterReplay?.providerMessageId,
    rowCount: count.recordset[0]?.cnt,
    duplicate: second.duplicate,
  });

  if (Number(count.recordset[0]?.cnt) !== 1) {
    throw new Error('Expected a single outbox row');
  }
  if (afterReplay?.providerMessageId !== afterSend.providerMessageId) {
    throw new Error('ProviderMessageID changed on replay');
  }

  await pool.request().input('key', KEY).query(
    `DELETE FROM dbo.TblMessageOutbox WHERE IdempotencyKey = @key`,
  );
  console.log('deleted test row', KEY);
  await closePool();
  console.log('Phase 5C1 live verification OK');
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('live verification failed', message);
  process.exit(1);
});

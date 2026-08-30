/**
 * Safe requeue + trace for Outbox 10005 / whatsapp-bot-ai-turn:5
 * Does not create inbound, AI turn, or another outbox row.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

const OUTBOX_ID = 10005;
const IDEM = 'whatsapp-bot-ai-turn:5';
const TURN_ID = 5;
const INBOX_ID = 144;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const { getPool, closePool, sql } = await import('../src/lib/db');
  const pool = await getPool();

  const pre = await pool
    .request()
    .input('id', sql.BigInt, OUTBOX_ID)
    .input('idem', sql.NVarChar(200), IDEM)
    .query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.TblMessageOutbox
          WHERE ID = @id AND Status = N'failed' AND IdempotencyKey = @idem) AS matchCount,
        (SELECT COUNT(*) FROM dbo.TblMessageOutbox WHERE IdempotencyKey = @idem) AS idemCount,
        o.ID, o.Status, o.AttemptCount, o.MaxAttempts, o.ProviderMessageID,
        o.IdempotencyKey, o.LastError, o.FailedAt
      FROM dbo.TblMessageOutbox o
      WHERE o.ID = @id
    `);

  const preRow = pre.recordset[0];
  console.log('PRECHECK', {
    matchCount: preRow?.matchCount,
    idemCount: preRow?.idemCount,
    id: preRow?.ID != null ? Number(preRow.ID) : null,
    status: preRow?.Status,
    attemptCount: preRow?.AttemptCount,
    providerMessageId: preRow?.ProviderMessageID,
    idempotencyKey: preRow?.IdempotencyKey,
  });

  if (Number(preRow?.matchCount) !== 1) {
    console.error('PRECHECK_FAIL matchCount!=1');
    await closePool();
    process.exit(2);
  }
  if (Number(preRow?.idemCount) !== 1) {
    console.error('PRECHECK_FAIL idemCount!=1');
    await closePool();
    process.exit(2);
  }
  if (preRow?.ProviderMessageID != null && String(preRow.ProviderMessageID).trim() !== '') {
    console.error('PRECHECK_FAIL ProviderMessageID already set');
    await closePool();
    process.exit(2);
  }

  const upd = await pool
    .request()
    .input('id', sql.BigInt, OUTBOX_ID)
    .input('idem', sql.NVarChar(200), IDEM)
    .query(`
      UPDATE dbo.TblMessageOutbox
      SET
        Status = N'pending',
        AttemptCount = 0,
        NextAttemptAt = SYSUTCDATETIME(),
        FailedAt = NULL,
        LockedAt = NULL,
        LockedBy = NULL,
        LastError = N'manual_requeue_after_baileys_send_fix',
        UpdatedAt = SYSUTCDATETIME()
      WHERE ID = @id
        AND Status = N'failed'
        AND IdempotencyKey = @idem;

      SELECT @@ROWCOUNT AS rowsUpdated;

      SELECT ID, Status, AttemptCount, NextAttemptAt, FailedAt, LockedBy, LastError, ProviderMessageID, IdempotencyKey
      FROM dbo.TblMessageOutbox WHERE ID = @id;
    `);

  const rowsUpdated = Number(upd.recordsets[0]?.[0]?.rowsUpdated ?? 0);
  const after = upd.recordsets[1]?.[0];
  console.log('REQUEUE', { rowsUpdated, after });

  if (rowsUpdated !== 1 || after?.Status !== 'pending') {
    console.error('REQUEUE_FAIL');
    await closePool();
    process.exit(3);
  }

  let terminal: any = null;
  const deadline = Date.now() + 180_000;
  let i = 0;
  while (Date.now() < deadline) {
    const q = await pool
      .request()
      .input('id', sql.BigInt, OUTBOX_ID)
      .input('idem', sql.NVarChar(200), IDEM)
      .input('turnId', sql.BigInt, TURN_ID)
      .input('inboxId', sql.BigInt, INBOX_ID)
      .query(`
        SELECT
          o.ID, o.Status, o.AttemptCount, o.ProviderMessageID, o.IdempotencyKey,
          o.LastError, o.SentAt, o.UpdatedAt, o.FailedAt,
          (SELECT COUNT(*) FROM dbo.TblMessageOutbox WHERE IdempotencyKey = @idem) AS outboxIdemCount,
          (SELECT COUNT(*) FROM dbo.TblBotAiTurn WHERE TurnID = @turnId) AS aiTurnCount,
          (SELECT COUNT(*) FROM dbo.TblBotAiTurn WHERE ConversationID = 6 AND TurnID <> @turnId
             AND CreatedAt >= (SELECT CreatedAt FROM dbo.TblBotAiTurn WHERE TurnID = @turnId)) AS laterAiTurns,
          (SELECT COUNT(*) FROM dbo.TblMessageInbox WHERE ID = @inboxId) AS inboxCount,
          (SELECT COUNT(*) FROM dbo.TblMessageInbox
            WHERE Phone = N'201557994946' AND ID > @inboxId) AS laterSamePhoneInbox
        FROM dbo.TblMessageOutbox o
        WHERE o.ID = @id
      `);
    const row = q.recordset[0];
    console.log('TRACE', {
      i,
      status: row.Status,
      attempts: Number(row.AttemptCount),
      providerMessageId: row.ProviderMessageID,
      lastError: row.LastError ? String(row.LastError).slice(0, 180) : null,
      outboxIdemCount: Number(row.outboxIdemCount),
      aiTurnCount: Number(row.aiTurnCount),
      laterAiTurns: Number(row.laterAiTurns),
      laterSamePhoneInbox: Number(row.laterSamePhoneInbox),
    });

    if (row.Status === 'sent' && row.ProviderMessageID) {
      // loop-safety wait
      const until = Date.now() + 20000;
      let lastLoop = row;
      while (Date.now() < until) {
        await sleep(4000);
        const loop = await pool
          .request()
          .input('id', sql.BigInt, OUTBOX_ID)
          .input('idem', sql.NVarChar(200), IDEM)
          .input('turnId', sql.BigInt, TURN_ID)
          .input('inboxId', sql.BigInt, INBOX_ID)
          .query(`
            SELECT
              o.ID, o.Status, o.AttemptCount, o.ProviderMessageID, o.IdempotencyKey,
              o.LastError, o.SentAt,
              (SELECT COUNT(*) FROM dbo.TblMessageOutbox WHERE IdempotencyKey = @idem) AS outboxIdemCount,
              (SELECT COUNT(*) FROM dbo.TblBotAiTurn WHERE TurnID = @turnId) AS aiTurnCount,
              (SELECT COUNT(*) FROM dbo.TblBotAiTurn WHERE ConversationID = 6 AND TurnID <> @turnId
                 AND CreatedAt >= (SELECT CreatedAt FROM dbo.TblBotAiTurn WHERE TurnID = @turnId)) AS laterAiTurns,
              (SELECT COUNT(*) FROM dbo.TblMessageInbox WHERE ID = @inboxId) AS inboxCount,
              (SELECT COUNT(*) FROM dbo.TblMessageInbox
                WHERE Phone = N'201557994946' AND ID > @inboxId) AS laterSamePhoneInbox,
              (SELECT LEFT(ISNULL(Text,N''), 120) FROM dbo.TblBotMessage WHERE MessageID = 81) AS replyPreview
            FROM dbo.TblMessageOutbox o WHERE o.ID = @id
          `);
        lastLoop = loop.recordset[0];
        console.log('LOOP_CHECK', {
          status: lastLoop.Status,
          providerMessageId: lastLoop.ProviderMessageID,
          outboxIdemCount: Number(lastLoop.outboxIdemCount),
          aiTurnCount: Number(lastLoop.aiTurnCount),
          laterAiTurns: Number(lastLoop.laterAiTurns),
          laterSamePhoneInbox: Number(lastLoop.laterSamePhoneInbox),
          replyPreview: lastLoop.replyPreview,
        });
      }
      terminal = { outcome: 'sent', row: lastLoop };
      break;
    }

    if (row.Status === 'failed') {
      terminal = { outcome: 'failed', row };
      break;
    }

    i += 1;
    await sleep(1500);
  }

  console.log('TERMINAL', terminal);
  await closePool();

  if (!terminal || terminal.outcome !== 'sent') {
    process.exit(4);
  }

  const r = terminal.row;
  const ok =
    Number(r.ID) === OUTBOX_ID &&
    String(r.IdempotencyKey) === IDEM &&
    r.Status === 'sent' &&
    Boolean(r.ProviderMessageID) &&
    Number(r.outboxIdemCount) === 1 &&
    Number(r.aiTurnCount) === 1 &&
    Number(r.laterAiTurns) === 0 &&
    Number(r.laterSamePhoneInbox) === 0;

  process.exit(ok ? 0 : 5);
}

main().catch((e) => {
  console.error('FAIL', e instanceof Error ? e.message : e);
  process.exit(1);
});

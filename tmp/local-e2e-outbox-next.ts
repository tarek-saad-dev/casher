import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const orig = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return orig.call(this, r, ...rest);
};

async function main() {
  const { getPool, closePool } = await import('../src/lib/db');
  const p = await getPool();
  const q = await p.request().query(`
    SELECT ID, Status, AttemptCount, MaxAttempts, NextAttemptAt, LockedAt, LockedBy,
      ProviderMessageID, UpdatedAt, SentAt, FailedAt,
      LEFT(ISNULL(LastError,N''), 300) AS err,
      DATEDIFF(SECOND, SYSUTCDATETIME(), NextAttemptAt) AS secondsUntilNext
    FROM dbo.TblMessageOutbox WHERE ID = 10005
  `);
  console.log(JSON.stringify(q.recordset[0], null, 2));

  // exact-once counts for marker
  const counts = await p.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblMessageInbox WHERE Text = N'LOCAL-AI-E2E-20260829124000') AS inbox,
      (SELECT COUNT(*) FROM dbo.TblBotMessage WHERE InboxID = 144 AND Direction = N'inbound') AS inboundBotMsg,
      (SELECT COUNT(*) FROM dbo.TblBotMessage WHERE MessageID = 81 AND Direction = N'outbound') AS outboundBotMsg,
      (SELECT COUNT(*) FROM dbo.TblBotAiTurn WHERE TurnID = 5) AS aiTurn,
      (SELECT COUNT(*) FROM dbo.TblMessageOutbox WHERE IdempotencyKey = N'whatsapp-bot-ai-turn:5') AS outbox,
      (SELECT COUNT(*) FROM dbo.TblMessageInbox WHERE Phone = N'201557994946' AND ID > 144) AS laterSamePhone
  `);
  console.log('counts', counts.recordset[0]);
  await closePool();
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});

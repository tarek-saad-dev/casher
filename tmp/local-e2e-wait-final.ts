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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const { getPool, closePool } = await import('../src/lib/db');
  const p = await getPool();
  let terminal: any = null;
  for (let i = 0; i < 40; i++) {
    const q = await p.request().query(`
      SELECT Status, AttemptCount, ProviderMessageID, NextAttemptAt, UpdatedAt,
        LEFT(ISNULL(LastError, N''), 220) AS err,
        DATEDIFF(SECOND, SYSUTCDATETIME(), NextAttemptAt) AS secLeft
      FROM dbo.TblMessageOutbox WHERE ID = 10005
    `);
    const row = q.recordset[0];
    console.log(JSON.stringify({ i, ...row }));
    if (row.Status === 'sent' && row.ProviderMessageID) {
      terminal = { outcome: 'sent', row };
      break;
    }
    if (row.Status === 'failed') {
      terminal = { outcome: 'failed', row };
      break;
    }
    await sleep(5000);
  }

  const counts = await p.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblMessageInbox WHERE Text = N'LOCAL-AI-E2E-20260829124000') AS inbox,
      (SELECT COUNT(*) FROM dbo.TblBotMessage WHERE InboxID = 144 AND Direction = N'inbound') AS inbound,
      (SELECT COUNT(*) FROM dbo.TblBotAiTurn WHERE TurnID = 5) AS ai,
      (SELECT COUNT(*) FROM dbo.TblMessageOutbox WHERE IdempotencyKey = N'whatsapp-bot-ai-turn:5') AS outbox,
      (SELECT COUNT(*) FROM dbo.TblMessageInbox WHERE Phone = N'201557994946' AND ID > 144) AS later
  `);
  console.log('terminal', terminal);
  console.log('counts', counts.recordset[0]);
  await closePool();
  if (!terminal) process.exit(5);
  process.exit(terminal.outcome === 'sent' ? 0 : 4);
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});

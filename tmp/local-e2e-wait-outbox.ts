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
  const cols = await p.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'TblMessageOutbox' ORDER BY ORDINAL_POSITION
  `);
  console.log('cols', cols.recordset.map((r: any) => r.COLUMN_NAME));

  for (let i = 0; i < 24; i++) {
    const q = await p.request().query(`
      SELECT ID, Status, AttemptCount, ProviderMessageID, UpdatedAt,
        LEFT(ISNULL(LastError,N''), 250) AS err
      FROM dbo.TblMessageOutbox WHERE ID = 10005
    `);
    const row = q.recordset[0];
    console.log('tick', i, row);
    if (row.Status === 'sent' && row.ProviderMessageID) {
      // loop check
      const loop = await p.request().query(`
        SELECT
          (SELECT COUNT(*) FROM dbo.TblMessageInbox WHERE Text = N'LOCAL-AI-E2E-20260829124000') AS markerInbox,
          (SELECT COUNT(*) FROM dbo.TblBotMessage WHERE InboxID = 144 AND Direction = N'inbound') AS inboundMsgs,
          (SELECT COUNT(*) FROM dbo.TblBotAiTurn WHERE TurnID = 5) AS aiTurns,
          (SELECT COUNT(*) FROM dbo.TblMessageOutbox WHERE IdempotencyKey = N'whatsapp-bot-ai-turn:5') AS outboxRows,
          (SELECT COUNT(*) FROM dbo.TblMessageInbox
            WHERE Phone = N'201557994946' AND ID > 144
              AND CreatedAt <= DATEADD(SECOND, 30, SYSUTCDATETIME())) AS laterSamePhone
      `);
      console.log('LOOP', loop.recordset[0]);
      await closePool();
      process.exit(0);
    }
    if (row.Status === 'failed') {
      console.log('FAILED_FINAL', row);
      await closePool();
      process.exit(4);
    }
    await sleep(5000);
  }
  await closePool();
  process.exit(5);
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});

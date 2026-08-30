#!/usr/bin/env npx tsx
import Module from 'module';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', override: true });
const mod = Module as any;
const o = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};

async function main() {
  const { getPool, closePool } = await import('../src/lib/db.ts');
  const p = await getPool();

  const recent = await p.request().query(`
    SELECT TOP 15 i.ID, i.Text, i.CreatedAt, i.Status,
      m.MessageID, m.Direction,
      t.TurnID, t.Status AS AiStatus, t.Intent,
      LEFT(ISNULL(o.Content,N''), 300) AS OutContent,
      o.SentAt
    FROM dbo.TblMessageInbox i
    LEFT JOIN dbo.TblBotMessage m ON m.InboxID = i.ID
    LEFT JOIN dbo.TblBotAiTurn t ON t.LatestInboundMessageID = m.MessageID OR t.AnchorInboundMessageID = m.MessageID
    LEFT JOIN dbo.TblMessageOutbox o ON o.ID = t.OutboxID
    WHERE i.Phone = N'201557994946'
      AND i.CreatedAt >= DATEADD(MINUTE, -45, SYSUTCDATETIME())
    ORDER BY i.ID DESC
  `);

  const turns = await p.request().query(`
    SELECT TOP 5 TurnID, Status, Intent, CreatedAt, CompletedAt,
      LEFT(ISNULL(ResultJson,N''), 800) AS ResultSnippet
    FROM dbo.TblBotAiTurn
    WHERE ConversationID = 6
    ORDER BY TurnID DESC
  `);

  console.log(JSON.stringify({ recent: recent.recordset, turns: turns.recordset }, null, 2));
  await closePool();
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});

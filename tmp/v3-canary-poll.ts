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
  let lastId = 0;
  for (let i = 0; i < 18; i++) {
    const r = await p.request().query(`
      SELECT TOP 3 i.ID, i.Text, i.CreatedAt, i.Status, t.TurnID, t.Status AS AiStatus,
        LEFT(ISNULL(o.Content,N''), 250) AS reply
      FROM dbo.TblMessageInbox i
      LEFT JOIN dbo.TblBotMessage m ON m.InboxID = i.ID
      LEFT JOIN dbo.TblBotAiTurn t ON t.LatestInboundMessageID = m.MessageID
      LEFT JOIN dbo.TblMessageOutbox o ON o.ID = t.OutboxID
      WHERE i.Phone = N'201557994946'
      ORDER BY i.ID DESC
    `);
    const top = r.recordset[0] as { ID: number; Text: string } | undefined;
    if (top && top.ID > lastId) {
      lastId = top.ID;
      console.log('NEW', JSON.stringify(r.recordset));
    } else {
      console.log('poll', i, 'latest', top?.ID, top?.Text?.slice(0, 40));
    }
    if (top && top.ID > 255 && r.recordset[0]?.reply) break;
    await new Promise((res) => setTimeout(res, 8000));
  }
  await closePool();
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});

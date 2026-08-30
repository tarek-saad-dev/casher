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
    SELECT
      t.TurnID, t.Status, t.Intent, t.NeedsBusinessTool, t.OutboundMessageID, t.OutboxID,
      t.CreatedAt, t.ProcessingStartedAt, t.CompletedAt,
      LEFT(ISNULL(t.ResultJson, N''), 200) AS resultPreview,
      o.Status AS OutboxStatus, o.ProviderMessageID, o.AttemptCount,
      LEFT(ISNULL(o.Content, N''), 120) AS outboxPreview,
      m.InboxID, LEFT(ISNULL(im.Text, N''), 80) AS inboundText
    FROM dbo.TblBotAiTurn t
    LEFT JOIN dbo.TblMessageOutbox o ON o.ID = t.OutboxID
    LEFT JOIN dbo.TblBotMessage m ON m.MessageID = t.LatestInboundMessageID
    LEFT JOIN dbo.TblMessageInbox im ON im.ID = m.InboxID
    ORDER BY t.TurnID DESC
  `);
  console.log(JSON.stringify(q.recordset, null, 2));
  await closePool();
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});

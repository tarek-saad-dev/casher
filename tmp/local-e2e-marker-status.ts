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
      i.ID AS InboxID, i.Status AS InboxStatus, i.Text, i.ProviderMessageID,
      i.CreatedAt AS InboxCreatedAt, i.ProcessedAt,
      m.MessageID AS InboundMsgID, c.ConversationID, c.ControlMode, c.ExternalContactKey,
      t.TurnID, t.Status AS AiStatus, t.Intent, t.NeedsBusinessTool,
      t.OutboundMessageID, t.OutboxID, t.CreatedAt AS AiCreated, t.ProcessingStartedAt, t.CompletedAt AS AiDone,
      LEFT(ISNULL(t.ResultJson,N''), 250) AS resultPreview,
      om.MessageID AS OutboundMsgID, LEFT(ISNULL(om.Text,N''), 120) AS replyPreview,
      o.ID AS OutboxID, o.Status AS OutboxStatus, o.AttemptCount, o.IdempotencyKey,
      o.ProviderMessageID, o.CreatedAt AS OutboxCreated, o.UpdatedAt AS OutboxUpdated,
      LEFT(ISNULL(o.LastError,N''), 400) AS OutboxErr,
      (SELECT COUNT(*) FROM dbo.TblMessageInbox WHERE Text = N'LOCAL-AI-E2E-20260829124000') AS markerInboxCount,
      (SELECT COUNT(*) FROM dbo.TblBotMessage WHERE InboxID = i.ID) AS msgsForInbox,
      (SELECT COUNT(*) FROM dbo.TblBotAiTurn WHERE TurnID = t.TurnID) AS turnCount,
      (SELECT COUNT(*) FROM dbo.TblMessageOutbox WHERE IdempotencyKey = o.IdempotencyKey) AS outboxIdemCount
    FROM dbo.TblMessageInbox i
    LEFT JOIN dbo.TblBotMessage m ON m.InboxID = i.ID
    LEFT JOIN dbo.TblBotConversation c ON c.ConversationID = m.ConversationID
    LEFT JOIN dbo.TblBotAiTurn t ON t.LatestInboundMessageID = m.MessageID OR t.AnchorInboundMessageID = m.MessageID
    LEFT JOIN dbo.TblBotMessage om ON om.MessageID = t.OutboundMessageID
    LEFT JOIN dbo.TblMessageOutbox o ON o.ID = t.OutboxID
    WHERE i.Text = N'LOCAL-AI-E2E-20260829124000'
  `);
  console.log(JSON.stringify(q.recordset, null, 2));

  const nearby = await p.request().query(`
    SELECT ID, LEFT(ISNULL(Text,N''),80) AS text, Status, CreatedAt
    FROM dbo.TblMessageInbox
    WHERE Phone LIKE N'201557994946%'
      AND CreatedAt >= '2026-08-29T09:37:00'
    ORDER BY ID
  `);
  console.log('nearby_inbox', nearby.recordset);
  await closePool();
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});

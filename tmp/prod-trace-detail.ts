#!/usr/bin/env npx tsx
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

const appRoot = '/home/casher/app';
dotenv.config({ path: path.join(appRoot, '.env.local'), override: true });
const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const orig = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return orig.call(this, r, ...rest);
};

async function main() {
  const { getPool, closePool } = await import(path.join(appRoot, 'src/lib/db.ts'));
  const pool = await getPool();

  const marker = await pool.request().query(`
    SELECT i.ID, i.Text, i.Phone, i.CreatedAt, i.ProviderMessageID,
      m.MessageID, t.TurnID, t.Status, t.Intent, t.OutboundMessageID, t.OutboxID,
      o.Status AS OutboxStatus, o.ProviderMessageID AS OutProviderId, o.IdempotencyKey,
      LEFT(ISNULL(om.Text,N''), 120) AS reply
    FROM dbo.TblMessageInbox i
    LEFT JOIN dbo.TblBotMessage m ON m.InboxID = i.ID
    LEFT JOIN dbo.TblBotAiTurn t ON t.LatestInboundMessageID = m.MessageID OR t.AnchorInboundMessageID = m.MessageID
    LEFT JOIN dbo.TblMessageOutbox o ON o.ID = t.OutboxID
    LEFT JOIN dbo.TblBotMessage om ON om.MessageID = t.OutboundMessageID
    WHERE i.Text = N'PROD-AI-SMOKE-20260829-01'
  `);
  console.log('MARKER', JSON.stringify(marker.recordset, null, 2));

  const nearby = await pool.request().query(`
    SELECT i.ID, LEFT(ISNULL(i.Text,N''), 100) AS text, i.CreatedAt, i.Status,
      m.MessageID, m.Direction,
      t.TurnID, t.Status AS AiStatus, o.ID AS OutboxID, o.Status AS OutboxStatus,
      o.ProviderMessageID, o.IdempotencyKey
    FROM dbo.TblMessageInbox i
    LEFT JOIN dbo.TblBotMessage m ON m.InboxID = i.ID
    LEFT JOIN dbo.TblBotAiTurn t ON t.LatestInboundMessageID = m.MessageID OR t.AnchorInboundMessageID = m.MessageID
    LEFT JOIN dbo.TblMessageOutbox o ON o.ID = t.OutboxID
    WHERE i.Phone = N'201557994946'
      AND i.CreatedAt >= '2026-08-29T10:46:00'
    ORDER BY i.ID
  `);
  console.log('NEARBY_INBOX', JSON.stringify(nearby.recordset, null, 2));

  const turns = await pool.request().query(`
    SELECT TurnID, Status, Intent, AnchorInboundMessageID, LatestInboundMessageID,
      OutboundMessageID, OutboxID, CreatedAt, CompletedAt
    FROM dbo.TblBotAiTurn
    WHERE ConversationID = 6 AND CreatedAt >= '2026-08-29T10:46:00'
    ORDER BY TurnID
  `);
  console.log('TURNS', JSON.stringify(turns.recordset, null, 2));

  const scoped = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblMessageInbox WHERE Text = N'PROD-AI-SMOKE-20260829-01') AS markerInbox,
      (SELECT COUNT(*) FROM dbo.TblBotMessage WHERE InboxID = 159 AND Direction = N'inbound') AS inboundForMarker,
      (SELECT COUNT(*) FROM dbo.TblBotAiTurn WHERE TurnID = 20) AS turn20,
      (SELECT COUNT(*) FROM dbo.TblMessageOutbox WHERE IdempotencyKey = N'whatsapp-bot-ai-turn:20') AS outboxForTurn20,
      (SELECT COUNT(*) FROM dbo.TblMessageInbox
        WHERE Phone = N'201557994946' AND ID > 159
          AND (Text LIKE N'أهلاً%' OR Text LIKE N'%نورتنا%' OR Text LIKE N'%تامرني%')) AS laterLookingLikeBotReply,
      (SELECT COUNT(*) FROM dbo.TblMessageOutbox WHERE ID = 10020 AND Status = N'sent' AND ProviderMessageID IS NOT NULL) AS outboxSentOk
  `);
  console.log('SCOPED', JSON.stringify(scoped.recordset[0], null, 2));

  await closePool();
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});

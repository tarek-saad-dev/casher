/**
 * Read-only trace of three real booking follow-ups on prod.
 * Phone 201557994946 around 10:55–10:58Z 2026-08-29.
 */
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
  const { getPool, closePool, sql } = await import(path.join(appRoot, 'src/lib/db.ts'));
  const pool = await getPool();

  const inbox = await pool.request().query(`
    SELECT
      i.ID AS InboxID,
      i.Provider,
      i.ProviderMessageID,
      i.Phone,
      i.Text,
      i.Status AS InboxStatus,
      i.ReceivedAt,
      i.CreatedAt AS InboxCreatedAt,
      i.ProcessedAt
    FROM dbo.TblMessageInbox i
    WHERE i.Phone = N'201557994946'
      AND i.CreatedAt >= '2026-08-29T10:55:00'
      AND i.CreatedAt < '2026-08-29T11:00:00'
    ORDER BY i.ID
  `);
  console.log('INBOX_WINDOW', JSON.stringify(inbox.recordset, null, 2));

  const full = await pool.request().query(`
    SELECT
      i.ID AS InboxID,
      i.ProviderMessageID AS InboundProviderMessageID,
      i.Text AS InboundText,
      i.Status AS InboxStatus,
      i.ReceivedAt,
      i.CreatedAt AS InboxCreatedAt,
      m.MessageID AS InboundBotMessageID,
      m.Direction AS InboundDirection,
      m.ConversationID,
      c.ControlMode,
      t.TurnID,
      t.Status AS AiStatus,
      t.Intent,
      t.NeedsBusinessTool,
      t.AnchorInboundMessageID,
      t.LatestInboundMessageID,
      t.OutboundMessageID,
      t.OutboxID AS TurnOutboxID,
      t.CreatedAt AS AiCreatedAt,
      t.ProcessingStartedAt AS AiStartedAt,
      t.CompletedAt AS AiCompletedAt,
      t.ErrorCode AS AiErrorCode,
      LEFT(ISNULL(t.LastError, N''), 400) AS AiLastError,
      om.MessageID AS OutboundBotMessageID,
      om.Direction AS OutboundDirection,
      om.Text AS ExactReplyText,
      o.ID AS OutboxID,
      o.Status AS OutboxStatus,
      o.AttemptCount,
      o.MaxAttempts,
      o.SentAt,
      o.FailedAt,
      o.ProviderMessageID AS OutboundProviderMessageID,
      o.IdempotencyKey,
      LEFT(ISNULL(o.LastError, N''), 400) AS OutboxLastError,
      o.CreatedAt AS OutboxCreatedAt,
      o.UpdatedAt AS OutboxUpdatedAt,
      o.Content AS OutboxContent
    FROM dbo.TblMessageInbox i
    LEFT JOIN dbo.TblBotMessage m
      ON m.InboxID = i.ID AND m.Direction = N'inbound'
    LEFT JOIN dbo.TblBotConversation c ON c.ConversationID = m.ConversationID
    LEFT JOIN dbo.TblBotAiTurn t
      ON t.ConversationID = m.ConversationID
     AND (t.AnchorInboundMessageID = m.MessageID OR t.LatestInboundMessageID = m.MessageID)
    LEFT JOIN dbo.TblBotMessage om ON om.MessageID = t.OutboundMessageID
    LEFT JOIN dbo.TblMessageOutbox o ON o.ID = t.OutboxID
    WHERE i.Phone = N'201557994946'
      AND i.CreatedAt >= '2026-08-29T10:55:00'
      AND i.CreatedAt < '2026-08-29T11:00:00'
    ORDER BY i.ID, t.TurnID
  `);
  console.log('FULL_TRACE', JSON.stringify(full.recordset, null, 2));

  // Exactly-once counts per inbound message
  const counts = await pool.request().query(`
    SELECT
      i.ID AS InboxID,
      i.Text AS InboundText,
      (SELECT COUNT(*) FROM dbo.TblBotMessage bm
        WHERE bm.InboxID = i.ID AND bm.Direction = N'inbound') AS inboundBotMsgCount,
      (SELECT COUNT(*) FROM dbo.TblBotAiTurn t
        WHERE t.AnchorInboundMessageID = m.MessageID
           OR t.LatestInboundMessageID = m.MessageID) AS aiTurnCount,
      (SELECT COUNT(*) FROM dbo.TblMessageOutbox o
        INNER JOIN dbo.TblBotAiTurn t2 ON t2.OutboxID = o.ID
        WHERE t2.AnchorInboundMessageID = m.MessageID
           OR t2.LatestInboundMessageID = m.MessageID) AS outboxCount,
      (SELECT COUNT(*) FROM dbo.TblBotMessage om
        INNER JOIN dbo.TblBotAiTurn t3 ON t3.OutboundMessageID = om.MessageID
        WHERE t3.AnchorInboundMessageID = m.MessageID
           OR t3.LatestInboundMessageID = m.MessageID) AS outboundBotMsgCount
    FROM dbo.TblMessageInbox i
    LEFT JOIN dbo.TblBotMessage m ON m.InboxID = i.ID AND m.Direction = N'inbound'
    WHERE i.Phone = N'201557994946'
      AND i.CreatedAt >= '2026-08-29T10:55:00'
      AND i.CreatedAt < '2026-08-29T11:00:00'
    ORDER BY i.ID
  `);
  console.log('EXACTLY_ONCE', JSON.stringify(counts.recordset, null, 2));

  // Check if NeedsBusinessTool column / any tool claim tables / turn payload
  const turnCols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'TblBotAiTurn'
    ORDER BY ORDINAL_POSITION
  `);
  console.log('AI_TURN_COLUMNS', JSON.stringify(turnCols.recordset, null, 2));

  // Pull full turn rows for these three
  const turnsDetail = await pool.request().query(`
    SELECT t.*
    FROM dbo.TblBotAiTurn t
    WHERE t.TurnID IN (21, 22, 23)
       OR t.TurnID IN (
         SELECT DISTINCT t2.TurnID
         FROM dbo.TblMessageInbox i
         JOIN dbo.TblBotMessage m ON m.InboxID = i.ID AND m.Direction = N'inbound'
         JOIN dbo.TblBotAiTurn t2
           ON t2.AnchorInboundMessageID = m.MessageID OR t2.LatestInboundMessageID = m.MessageID
         WHERE i.Phone = N'201557994946'
           AND i.CreatedAt >= '2026-08-29T10:55:00'
           AND i.CreatedAt < '2026-08-29T11:00:00'
       )
    ORDER BY t.TurnID
  `);
  console.log('TURNS_RAW', JSON.stringify(turnsDetail.recordset, null, 2));

  // Any booking claim/reservation rows created around this window for this phone?
  const bookingTables = await pool.request().query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME LIKE '%Book%' OR TABLE_NAME LIKE '%Reserv%' OR TABLE_NAME LIKE '%Appoint%'
       OR TABLE_NAME LIKE '%Tool%' OR TABLE_NAME LIKE '%Claim%'
    ORDER BY TABLE_NAME
  `);
  console.log('BOOKING_RELATED_TABLES', bookingTables.recordset.map((r: any) => r.TABLE_NAME));

  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

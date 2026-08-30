/**
 * Trace PHASE2-READ-SMOKE marker through inbox → AI tools → outbox.
 * Read-only.
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

const MARKER = process.argv[2] || 'PHASE2-READ-SMOKE-20260829-124124';
const waitMs = Number(process.argv[3] || 180000);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function msBetween(a: unknown, b: unknown): number | null {
  if (a == null || b == null) return null;
  const x = new Date(String(a)).getTime();
  const y = new Date(String(b)).getTime();
  if (Number.isNaN(x) || Number.isNaN(y)) return null;
  return Math.round(y - x);
}

async function main() {
  const { getPool, closePool, sql } = await import(path.join(appRoot, 'src/lib/db.ts'));
  const pool = await getPool();
  console.log(JSON.stringify({ tracing: MARKER, waitMs }));

  let inboxId: number | null = null;
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const found = await pool
      .request()
      .input('marker', sql.NVarChar(300), MARKER)
      .query(`
        SELECT TOP 5 ID, Text, Phone, Status, ReceivedAt, CreatedAt, ProcessedAt, ProviderMessageID
        FROM dbo.TblMessageInbox
        WHERE Text LIKE N'%' + @marker + N'%'
        ORDER BY ID DESC
      `);
    if (found.recordset.length) {
      inboxId = Number(found.recordset[0].ID);
      console.log('INBOX', JSON.stringify(found.recordset, null, 2));
      break;
    }
    await sleep(500);
  }
  if (inboxId == null) {
    console.error('FAIL_BOUNDARY=inbox_not_found');
    await closePool();
    process.exit(2);
  }

  let row: any = null;
  while (Date.now() < deadline) {
    const trace = await pool
      .request()
      .input('inboxId', sql.BigInt, inboxId)
      .query(`
        SELECT
          i.ID AS InboxID, i.Text, i.Phone, i.Status AS InboxStatus,
          i.ReceivedAt, i.CreatedAt AS InboxCreatedAt, i.ProcessedAt,
          i.ProviderMessageID AS InboundProviderMessageID,
          m.MessageID AS InboundBotMessageID, m.ConversationID,
          t.TurnID, t.Status AS AiStatus, t.Intent, t.NeedsBusinessTool,
          t.Confidence, t.ResultJson, t.CreatedAt AS AiCreatedAt,
          t.ProcessingStartedAt AS AiStartedAt, t.CompletedAt AS AiCompletedAt,
          t.OutboundMessageID, t.OutboxID AS TurnOutboxID,
          t.ErrorCode, LEFT(ISNULL(t.LastError,N''), 300) AS AiLastError,
          om.Text AS ExactReplyText,
          o.ID AS OutboxID, o.Status AS OutboxStatus, o.AttemptCount,
          o.SentAt, o.ProviderMessageID AS OutboundProviderMessageID,
          o.IdempotencyKey, LEFT(ISNULL(o.LastError,N''), 300) AS OutboxLastError,
          o.CreatedAt AS OutboxCreatedAt,
          (SELECT COUNT(*) FROM dbo.TblMessageInbox x WHERE x.Text LIKE N'%' + CAST(@inboxId AS NVARCHAR(40)) + N'%') AS dummy,
          (SELECT COUNT(*) FROM dbo.TblBotMessage bm WHERE bm.InboxID = i.ID AND bm.Direction=N'inbound') AS inboundCount,
          (SELECT COUNT(*) FROM dbo.TblBotAiTurn at2
            WHERE at2.AnchorInboundMessageID = m.MessageID OR at2.LatestInboundMessageID = m.MessageID) AS turnCount,
          (SELECT COUNT(*) FROM dbo.TblMessageOutbox ox
            WHERE t.TurnID IS NOT NULL AND ox.IdempotencyKey = CONCAT(N'whatsapp-bot-ai-turn:', CAST(t.TurnID AS NVARCHAR(40)))) AS outboxCount
        FROM dbo.TblMessageInbox i
        LEFT JOIN dbo.TblBotMessage m ON m.InboxID = i.ID AND m.Direction = N'inbound'
        LEFT JOIN dbo.TblBotAiTurn t
          ON t.ConversationID = m.ConversationID
         AND (t.AnchorInboundMessageID = m.MessageID OR t.LatestInboundMessageID = m.MessageID)
        LEFT JOIN dbo.TblBotMessage om ON om.MessageID = t.OutboundMessageID
        LEFT JOIN dbo.TblMessageOutbox o ON o.ID = t.OutboxID
        WHERE i.ID = @inboxId
      `);
    // fix marker count separately
    row = trace.recordset[0];
    console.log(
      'TRACE',
      JSON.stringify({
        inboxStatus: row?.InboxStatus,
        aiStatus: row?.AiStatus,
        intent: row?.Intent,
        needsBusinessTool: row?.NeedsBusinessTool,
        outboxStatus: row?.OutboxStatus,
        providerMessageId: row?.OutboundProviderMessageID,
        inboundCount: row?.inboundCount,
        turnCount: row?.turnCount,
        outboxCount: row?.outboxCount,
        replyPreview: row?.ExactReplyText ? String(row.ExactReplyText).slice(0, 160) : null,
      }),
    );
    if (row?.AiStatus === 'failed') {
      console.error('FAIL_BOUNDARY=ai_failed', row.ErrorCode, row.AiLastError);
      await closePool();
      process.exit(3);
    }
    if (row?.OutboxStatus === 'failed') {
      console.error('FAIL_BOUNDARY=outbox_failed', row.OutboxLastError);
      await closePool();
      process.exit(4);
    }
    if (row?.OutboxStatus === 'sent' && row?.OutboundProviderMessageID) {
      break;
    }
    await sleep(800);
  }

  if (!(row?.OutboxStatus === 'sent' && row?.OutboundProviderMessageID)) {
    console.error('FAIL_BOUNDARY=timeout_waiting_for_sent');
    await closePool();
    process.exit(5);
  }

  let resultJson: any = null;
  try {
    resultJson = row.ResultJson ? JSON.parse(String(row.ResultJson)) : null;
  } catch {
    resultJson = { parseError: true, raw: String(row.ResultJson).slice(0, 500) };
  }

  console.log('FULL', JSON.stringify({
    inboxId: Number(row.InboxID),
    text: row.Text,
    phone: row.Phone,
    inboundProviderMessageId: row.InboundProviderMessageID,
    inboundBotMessageId: row.InboundBotMessageID != null ? Number(row.InboundBotMessageID) : null,
    conversationId: row.ConversationID != null ? Number(row.ConversationID) : null,
    turnId: row.TurnID != null ? Number(row.TurnID) : null,
    aiStatus: row.AiStatus,
    intent: row.Intent,
    needsBusinessTool: row.NeedsBusinessTool,
    confidence: row.Confidence,
    exactReply: row.ExactReplyText,
    outboxId: row.OutboxID != null ? Number(row.OutboxID) : null,
    outboxStatus: row.OutboxStatus,
    attemptCount: row.AttemptCount,
    sentAt: row.SentAt,
    outboundProviderMessageId: row.OutboundProviderMessageID,
    idempotencyKey: row.IdempotencyKey,
    inboundCount: Number(row.inboundCount),
    turnCount: Number(row.turnCount),
    outboxCount: Number(row.outboxCount),
    latency: {
      webhookToInboxMs: msBetween(row.ReceivedAt, row.InboxCreatedAt),
      inboxToConversationMs: msBetween(row.InboxCreatedAt, row.ProcessedAt),
      conversationToAiStartMs: msBetween(row.ProcessedAt, row.AiStartedAt),
      geminiOrAiMs: msBetween(row.AiStartedAt, row.AiCompletedAt),
      aiToOutboxMs: msBetween(row.AiCompletedAt, row.OutboxCreatedAt),
      outboxToSentMs: msBetween(row.OutboxCreatedAt, row.SentAt),
      totalMs: msBetween(row.ReceivedAt, row.SentAt),
    },
    resultJson,
  }, null, 2));

  // Write baseline compare
  const writes = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblBookingHold) AS holds_total,
      (SELECT COUNT(*) FROM dbo.TblBookingSlotClaim) AS claims_total,
      (SELECT COUNT(*) FROM dbo.TblPublicBookingCreateRequest) AS public_create_total,
      (SELECT COUNT(*) FROM dbo.Bookings) AS bookings_total
  `);
  console.log('WRITES_NOW', JSON.stringify(writes.recordset[0]));
  console.log('WRITES_BASELINE', JSON.stringify({
    holds_total: 0,
    claims_total: 1426,
    public_create_total: 667,
    bookings_total: 1567,
  }));

  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Trace one real LOCAL-AI-E2E marker through the full Cashier pipeline.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

const MARKER = process.argv[2] || 'LOCAL-AI-E2E-20260829124000';
const waitMs = Number(process.argv[3] || 120000);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function msBetween(a: unknown, b: unknown): number | null {
  if (!a || !b) return null;
  const x = new Date(String(a)).getTime();
  const y = new Date(String(b)).getTime();
  if (Number.isNaN(x) || Number.isNaN(y)) return null;
  return Math.round(y - x);
}

async function main() {
  const { getPool, closePool, sql } = await import('../src/lib/db');
  const pool = await getPool();
  const deadline = Date.now() + waitMs;
  let inboxId: number | null = null;

  console.log(JSON.stringify({ tracing: MARKER, waitMs }));

  while (Date.now() < deadline) {
    const found = await pool
      .request()
      .input('marker', sql.NVarChar(200), MARKER)
      .query(`
        SELECT TOP 5
          ID, Provider, ProviderMessageID, Phone, Text, Status, IsGroup,
          ReceivedAt, CreatedAt, ProcessedAt, RetryCount, LastError
        FROM dbo.TblMessageInbox
        WHERE Text = @marker OR Text LIKE @marker + N'%'
        ORDER BY ID DESC
      `);
    if (found.recordset.length) {
      inboxId = Number(found.recordset[0].ID);
      console.log('INBOX', {
        count: found.recordset.length,
        rows: found.recordset.map((r: any) => ({
          id: Number(r.ID),
          provider: r.Provider,
          providerMessageId: r.ProviderMessageID,
          phone: String(r.Phone).slice(0, 4) + '…',
          text: r.Text,
          status: r.Status,
          isGroup: r.IsGroup,
          receivedAt: r.ReceivedAt,
          createdAt: r.CreatedAt,
          processedAt: r.ProcessedAt,
          lastError: r.LastError,
        })),
      });
      break;
    }
    await sleep(400);
  }

  if (inboxId == null) {
    console.error('FAIL_BOUNDARY=inbound_webhook_or_inbox_persist');
    await closePool();
    process.exit(2);
  }

  let final: any = null;
  while (Date.now() < deadline) {
    const trace = await pool
      .request()
      .input('inboxId', sql.BigInt, inboxId)
      .input('marker', sql.NVarChar(200), MARKER)
      .query(`
        SELECT
          i.ID AS InboxID,
          i.Status AS InboxStatus,
          i.Provider,
          i.ProviderMessageID,
          i.Phone,
          i.Text,
          i.CreatedAt AS InboxCreatedAt,
          i.ProcessedAt AS InboxProcessedAt,
          c.ConversationID,
          c.Channel,
          c.Provider AS ConvProvider,
          c.ExternalContactKey,
          c.ControlMode,
          m.MessageID AS InboundMessageID,
          m.Direction AS InboundDirection,
          m.CreatedAt AS InboundMsgCreatedAt,
          t.TurnID,
          t.Status AS AiStatus,
          t.Intent,
          t.NeedsBusinessTool,
          t.Confidence,
          t.OutboundMessageID,
          t.OutboxID,
          t.CreatedAt AS AiCreatedAt,
          t.ProcessingStartedAt AS AiStartedAt,
          t.CompletedAt AS AiCompletedAt,
          t.ErrorCode AS AiErrorCode,
          t.LastError AS AiLastError,
          t.ResultJson,
          om.MessageID AS OutboundBotMessageID,
          om.Direction AS OutboundDirection,
          om.Text AS OutboundText,
          om.CreatedAt AS OutboundBotCreatedAt,
          o.ID AS OutboxRowID,
          o.Status AS OutboxStatus,
          o.Recipient,
          o.Content AS OutboxContent,
          o.IdempotencyKey,
          o.ProviderMessageID AS OutboxProviderMessageID,
          o.AttemptCount,
          o.CreatedAt AS OutboxCreatedAt,
          o.UpdatedAt AS OutboxUpdatedAt,
          o.LastError AS OutboxLastError,
          (SELECT COUNT(*) FROM dbo.TblMessageInbox x
            WHERE x.Text = @marker OR x.Text LIKE @marker + N'%') AS MarkerInboxCount,
          (SELECT COUNT(*) FROM dbo.TblBotMessage bm WHERE bm.InboxID = i.ID) AS BotMsgsForInbox,
          (SELECT COUNT(*) FROM dbo.TblBotAiTurn at2
            WHERE at2.ConversationID = c.ConversationID
              AND (at2.AnchorInboundMessageID = m.MessageID OR at2.LatestInboundMessageID = m.MessageID
                   OR at2.CreatedAt >= DATEADD(SECOND, -30, i.CreatedAt))) AS AiTurnsNear,
          (SELECT COUNT(*) FROM dbo.TblMessageOutbox ox
            WHERE t.TurnID IS NOT NULL
              AND ox.IdempotencyKey = CONCAT(N'whatsapp-bot-ai-turn:', CAST(t.TurnID AS NVARCHAR(40)))) AS OutboxByIdem,
          (SELECT COUNT(*) FROM dbo.TblMessageInbox i2
            WHERE i2.Phone = i.Phone
              AND i2.ID > i.ID
              AND i2.CreatedAt <= DATEADD(SECOND, 45, ISNULL(o.UpdatedAt, SYSUTCDATETIME()))) AS LaterInboxSamePhone45s
        FROM dbo.TblMessageInbox i
        LEFT JOIN dbo.TblBotMessage m ON m.InboxID = i.ID
        LEFT JOIN dbo.TblBotConversation c ON c.ConversationID = m.ConversationID
        LEFT JOIN dbo.TblBotAiTurn t
          ON t.ConversationID = c.ConversationID
         AND (t.AnchorInboundMessageID = m.MessageID OR t.LatestInboundMessageID = m.MessageID)
        LEFT JOIN dbo.TblBotMessage om ON om.MessageID = t.OutboundMessageID
        LEFT JOIN dbo.TblMessageOutbox o ON o.ID = t.OutboxID
        WHERE i.ID = @inboxId
      `);

    final = trace.recordset[0];
    console.log('TRACE', {
      inboxStatus: final?.InboxStatus,
      conversationId: final?.ConversationID ?? null,
      inboundMessageId: final?.InboundMessageID ?? null,
      aiTurnId: final?.TurnID ?? null,
      aiStatus: final?.AiStatus ?? null,
      intent: final?.Intent ?? null,
      needsBusinessTool: final?.NeedsBusinessTool ?? null,
      outboxStatus: final?.OutboxStatus ?? null,
      outboxProviderMessageId: final?.OutboxProviderMessageID ?? null,
      markerInboxCount: final?.MarkerInboxCount ?? null,
      botMsgsForInbox: final?.BotMsgsForInbox ?? null,
      aiTurnsNear: final?.AiTurnsNear ?? null,
      outboxByIdem: final?.OutboxByIdem ?? null,
      laterInboxSamePhone45s: final?.LaterInboxSamePhone45s ?? null,
      aiErrorCode: final?.AiErrorCode ?? null,
      outboxLastError: final?.OutboxLastError
        ? String(final.OutboxLastError).slice(0, 200)
        : null,
    });

    if (final?.AiStatus === 'failed') {
      console.error('FAIL_BOUNDARY=gemini_ai_turn');
      console.log('AI_ERROR', { code: final.AiErrorCode, err: final.AiLastError });
      await closePool();
      process.exit(3);
    }
    if (final?.OutboxStatus === 'failed') {
      console.error('FAIL_BOUNDARY=whatsapp_send_or_outbox');
      console.log('OUTBOX_ERROR', {
        status: final.OutboxStatus,
        attempts: final.AttemptCount,
        err: final.OutboxLastError,
      });
      await closePool();
      process.exit(4);
    }
    if (final?.OutboxStatus === 'sent' && final?.OutboxProviderMessageID) {
      // short loop-safety window
      const until = Date.now() + 15000;
      let lastLoop: any = null;
      while (Date.now() < until) {
        const loop = await pool
          .request()
          .input('inboxId', sql.BigInt, inboxId)
          .input('marker', sql.NVarChar(200), MARKER)
          .input('conversationId', sql.BigInt, final.ConversationID)
          .input('since', sql.DateTime2, final.InboxCreatedAt)
          .query(`
            SELECT
              (SELECT COUNT(*) FROM dbo.TblMessageInbox
                WHERE Text = @marker OR Text LIKE @marker + N'%') AS markerInboxCount,
              (SELECT COUNT(*) FROM dbo.TblBotMessage WHERE InboxID = @inboxId AND Direction = N'inbound') AS inboundForInbox,
              (SELECT COUNT(*) FROM dbo.TblBotAiTurn
                WHERE ConversationID = @conversationId AND CreatedAt >= @since) AS aiTurnsSince,
              (SELECT COUNT(*) FROM dbo.TblMessageOutbox o
                INNER JOIN dbo.TblBotAiTurn t ON t.OutboxID = o.ID
                WHERE t.ConversationID = @conversationId AND t.CreatedAt >= @since) AS outboxRepliesSince,
              (SELECT COUNT(*) FROM dbo.TblMessageInbox i2
                WHERE i2.Phone = (SELECT Phone FROM dbo.TblMessageInbox WHERE ID = @inboxId)
                  AND i2.ID <> @inboxId
                  AND i2.CreatedAt >= @since
                  AND i2.CreatedAt <= DATEADD(SECOND, 30, SYSUTCDATETIME())) AS laterSamePhone
          `);
        lastLoop = loop.recordset[0];
        console.log('LOOP_CHECK', lastLoop);
        await sleep(2500);
      }

      console.log('LATENCY', {
        inboxToConversationReadyMs: msBetween(final.InboxCreatedAt, final.InboxProcessedAt),
        conversationReadyToAiStartMs: msBetween(final.InboxProcessedAt, final.AiStartedAt),
        geminiMs: msBetween(final.AiStartedAt, final.AiCompletedAt),
        geminiCompleteToOutboxUpdatedMs: msBetween(final.AiCompletedAt, final.OutboxUpdatedAt),
        webhookPersistToOutboxSentMs: msBetween(final.InboxCreatedAt, final.OutboxUpdatedAt),
      });

      console.log('FINAL', {
        inboxId: Number(final.InboxID),
        conversationId: Number(final.ConversationID),
        inboundMessageId: Number(final.InboundMessageID),
        turnId: Number(final.TurnID),
        outboxId: Number(final.OutboxRowID),
        outboxStatus: final.OutboxStatus,
        providerMessageId: final.OutboxProviderMessageID,
        intent: final.Intent,
        needsBusinessTool: final.NeedsBusinessTool,
        replyLen: final.OutboundText ? String(final.OutboundText).length : 0,
        idempotencyKey: final.IdempotencyKey,
        markerInboxCount: Number(lastLoop?.markerInboxCount ?? final.MarkerInboxCount),
        inboundForInbox: Number(lastLoop?.inboundForInbox ?? final.BotMsgsForInbox),
        aiTurnsSince: Number(lastLoop?.aiTurnsSince ?? final.AiTurnsNear),
        outboxRepliesSince: Number(lastLoop?.outboxRepliesSince ?? final.OutboxByIdem),
        laterSamePhone: Number(lastLoop?.laterSamePhone ?? final.LaterInboxSamePhone45s),
        channel: final.Channel,
        controlMode: final.ControlMode,
        externalContactKey: final.ExternalContactKey
          ? String(final.ExternalContactKey).slice(0, 12) + '…'
          : null,
      });
      await closePool();
      process.exit(0);
    }

    await sleep(500);
  }

  console.error('FAIL_BOUNDARY=timeout_waiting_for_outbox_sent');
  console.log('LAST', {
    inboxStatus: final?.InboxStatus,
    aiStatus: final?.AiStatus,
    outboxStatus: final?.OutboxStatus,
    aiError: final?.AiLastError,
    outboxError: final?.OutboxLastError,
  });
  await closePool();
  process.exit(5);
}

main().catch((e) => {
  console.error('FAIL', e instanceof Error ? e.message : e);
  process.exit(1);
});

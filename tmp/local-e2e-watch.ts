/**
 * Watch for LOCAL-AI-E2E-* real inbound and trace pipeline stages.
 * Does not synthesize inbound. Does not print secrets or full prompts.
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

const MARKER = 'LOCAL-AI-E2E-';
const startedAt = process.argv[2] ? new Date(process.argv[2]) : new Date();
const timeoutMs = Number(process.argv[3] || 15 * 60 * 1000);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const { getPool, closePool, sql } = await import('../src/lib/db');
  const pool = await getPool();
  console.log(
    JSON.stringify({
      watching: MARKER,
      sinceUtc: startedAt.toISOString(),
      timeoutMs,
    }),
  );

  let inboxId: number | null = null;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const found = await pool
      .request()
      .input('since', sql.DateTime2, startedAt)
      .input('marker', sql.NVarChar(100), `%${MARKER}%`)
      .query(`
        SELECT TOP 5
          i.ID, i.Provider, i.ProviderMessageID, i.Phone, i.Text, i.Status,
          i.ReceivedAt, i.CreatedAt, i.ProcessedAt, i.IsGroup
        FROM dbo.TblMessageInbox i
        WHERE i.CreatedAt >= @since
          AND i.Text LIKE @marker
        ORDER BY i.ID DESC
      `);

    if (found.recordset.length) {
      const row = found.recordset[0];
      inboxId = Number(row.ID);
      console.log('INBOX_FOUND', {
        inboxId,
        provider: row.Provider,
        providerMessageId: row.ProviderMessageID,
        phone: String(row.Phone).slice(0, 4) + '…',
        text: row.Text,
        status: row.Status,
        receivedAt: row.ReceivedAt,
        createdAt: row.CreatedAt,
        processedAt: row.ProcessedAt,
        isGroup: row.IsGroup,
        inboxCount: found.recordset.length,
      });
      break;
    }
    await sleep(500);
  }

  if (inboxId == null) {
    console.error('TIMEOUT waiting for inbound LOCAL-AI-E2E message');
    await closePool();
    process.exit(2);
  }

  // Wait for conversation + AI + outbox completion
  let done = false;
  while (Date.now() < deadline && !done) {
    const trace = await pool
      .request()
      .input('inboxId', sql.BigInt, inboxId)
      .query(`
        SELECT
          i.ID AS InboxID,
          i.Status AS InboxStatus,
          i.CreatedAt AS InboxCreatedAt,
          i.ProcessedAt AS InboxProcessedAt,
          i.ProviderMessageID,
          i.Phone,
          i.Text,
          m.MessageID AS InboundMessageID,
          m.Direction AS InboundDirection,
          m.OccurredAt AS InboundOccurredAt,
          m.CreatedAt AS InboundCreatedAt,
          c.ConversationID,
          c.Channel,
          c.Provider AS ConvProvider,
          c.ExternalContactKey,
          c.ControlMode,
          t.TurnID,
          t.Status AS AiStatus,
          t.Intent,
          t.NeedsBusinessTool,
          t.OutboundMessageID,
          t.OutboxID,
          t.CreatedAt AS AiCreatedAt,
          t.ProcessingStartedAt AS AiStartedAt,
          t.CompletedAt AS AiCompletedAt,
          t.ErrorCode AS AiErrorCode,
          t.LastError AS AiLastError,
          t.ResultJson,
          om.MessageID AS OutboundBotMessageID,
          om.Text AS OutboundText,
          om.CreatedAt AS OutboundBotCreatedAt,
          o.ID AS OutboxRowID,
          o.Status AS OutboxStatus,
          o.Recipient AS OutboxRecipient,
          o.Content AS OutboxContent,
          o.ProviderMessageID AS OutboxProviderMessageID,
          o.AttemptCount,
          o.CreatedAt AS OutboxCreatedAt,
          o.UpdatedAt AS OutboxUpdatedAt,
          o.LastError AS OutboxLastError,
          (SELECT COUNT(*) FROM dbo.TblMessageInbox x WHERE x.Provider = i.Provider AND x.ProviderMessageID = i.ProviderMessageID) AS InboxDupCount,
          (SELECT COUNT(*) FROM dbo.TblBotMessage bm WHERE bm.InboxID = i.ID) AS BotMsgForInbox,
          (SELECT COUNT(*) FROM dbo.TblBotAiTurn at2 WHERE at2.ConversationID = c.ConversationID AND at2.CreatedAt >= i.CreatedAt) AS AiTurnsSince,
          (SELECT COUNT(*) FROM dbo.TblMessageOutbox ox WHERE ox.IdempotencyKey = CONCAT(N'whatsapp-bot-ai-turn:', CAST(t.TurnID AS NVARCHAR(30)))) AS OutboxByIdem
        FROM dbo.TblMessageInbox i
        LEFT JOIN dbo.TblBotMessage m ON m.InboxID = i.ID
        LEFT JOIN dbo.TblBotConversation c ON c.ConversationID = m.ConversationID
        LEFT JOIN dbo.TblBotAiTurn t ON t.AnchorInboundMessageID = m.MessageID OR t.LatestInboundMessageID = m.MessageID
        LEFT JOIN dbo.TblBotMessage om ON om.MessageID = t.OutboundMessageID
        LEFT JOIN dbo.TblMessageOutbox o ON o.ID = t.OutboxID
        WHERE i.ID = @inboxId
      `);

    const row = trace.recordset[0];
    const snapshot = {
      inboxStatus: row?.InboxStatus,
      conversationId: row?.ConversationID ?? null,
      inboundMessageId: row?.InboundMessageID ?? null,
      aiTurnId: row?.TurnID ?? null,
      aiStatus: row?.AiStatus ?? null,
      intent: row?.Intent ?? null,
      needsBusinessTool: row?.NeedsBusinessTool ?? null,
      outboxStatus: row?.OutboxStatus ?? null,
      outboxProviderMessageId: row?.OutboxProviderMessageID ?? null,
      inboxDupCount: row?.InboxDupCount ?? null,
      botMsgForInbox: row?.BotMsgForInbox ?? null,
      aiTurnsSince: row?.AiTurnsSince ?? null,
      outboxByIdem: row?.OutboxByIdem ?? null,
      aiErrorCode: row?.AiErrorCode ?? null,
    };
    console.log('TRACE', snapshot);

    if (row?.AiStatus === 'failed' || row?.AiStatus === 'skipped') {
      console.log('AI_TERMINAL', {
        status: row.AiStatus,
        errorCode: row.AiErrorCode,
        lastError: row.AiLastError,
      });
      console.log('FULL_TRACE', {
        ...row,
        ResultJson: row.ResultJson ? '[present]' : null,
        OutboundText: row.OutboundText ? `[len=${String(row.OutboundText).length}]` : null,
        OutboxContent: row.OutboxContent ? `[len=${String(row.OutboxContent).length}]` : null,
        Phone: row.Phone ? String(row.Phone).slice(0, 4) + '…' : null,
      });
      await closePool();
      process.exit(3);
    }

    if (row?.OutboxStatus === 'sent' && row?.OutboxProviderMessageID) {
      // loop-safety wait window
      const loopUntil = Date.now() + 20000;
      while (Date.now() < loopUntil) {
        const loop = await pool
          .request()
          .input('inboxId', sql.BigInt, inboxId)
          .input('conversationId', sql.BigInt, row.ConversationID)
          .input('since', sql.DateTime2, row.InboxCreatedAt)
          .query(`
            SELECT
              (SELECT COUNT(*) FROM dbo.TblMessageInbox WHERE ID = @inboxId) AS inboxRows,
              (SELECT COUNT(*) FROM dbo.TblBotMessage WHERE InboxID = @inboxId AND Direction = N'inbound') AS inboundMsgs,
              (SELECT COUNT(*) FROM dbo.TblBotAiTurn WHERE ConversationID = @conversationId AND CreatedAt >= @since) AS aiTurns,
              (SELECT COUNT(*) FROM dbo.TblMessageOutbox o
                 INNER JOIN dbo.TblBotAiTurn t ON t.OutboxID = o.ID
                 WHERE t.ConversationID = @conversationId AND t.CreatedAt >= @since) AS outboxReplies,
              (SELECT COUNT(*) FROM dbo.TblMessageInbox i2
                 WHERE i2.CreatedAt >= @since
                   AND i2.Phone = (SELECT Phone FROM dbo.TblMessageInbox WHERE ID = @inboxId)
                   AND i2.ID <> @inboxId) AS laterInboxSamePhone
          `);
        console.log('LOOP_CHECK', loop.recordset[0]);
        await sleep(2000);
      }

      const final = await pool
        .request()
        .input('inboxId', sql.BigInt, inboxId)
        .query(`
          SELECT
            i.CreatedAt AS webhookPersistedAt,
            i.ProcessedAt AS conversationReadyAt,
            t.CreatedAt AS aiTurnCreatedAt,
            t.ProcessingStartedAt AS geminiStartAt,
            t.CompletedAt AS geminiCompleteAt,
            o.CreatedAt AS outboxCreatedAt,
            o.UpdatedAt AS outboxUpdatedAt,
            o.Status AS outboxStatus,
            o.ProviderMessageID,
            t.Intent,
            t.NeedsBusinessTool,
            t.ResultJson,
            om.Text AS replyText
          FROM dbo.TblMessageInbox i
          LEFT JOIN dbo.TblBotMessage m ON m.InboxID = i.ID
          LEFT JOIN dbo.TblBotAiTurn t ON t.LatestInboundMessageID = m.MessageID OR t.AnchorInboundMessageID = m.MessageID
          LEFT JOIN dbo.TblBotMessage om ON om.MessageID = t.OutboundMessageID
          LEFT JOIN dbo.TblMessageOutbox o ON o.ID = t.OutboxID
          WHERE i.ID = @inboxId
        `);
      const f = final.recordset[0];
      const ms = (a: any, b: any) => {
        if (!a || !b) return null;
        return Math.round(new Date(b).getTime() - new Date(a).getTime());
      };
      console.log('LATENCY', {
        webhookToInboxPersistMs: 0,
        inboxToConversationReadyMs: ms(f.webhookPersistedAt, f.conversationReadyAt),
        conversationReadyToAiStartMs: ms(f.conversationReadyAt, f.geminiStartAt),
        geminiStartToCompleteMs: ms(f.geminiStartAt, f.geminiCompleteAt),
        geminiCompleteToOutboxUpdatedMs: ms(f.geminiCompleteAt, f.outboxUpdatedAt),
        webhookToOutboxSentMs: ms(f.webhookPersistedAt, f.outboxUpdatedAt),
        intent: f.Intent,
        needsBusinessTool: f.NeedsBusinessTool,
        replyLen: f.replyText ? String(f.replyText).length : 0,
        providerMessageId: f.ProviderMessageID,
        outboxStatus: f.outboxStatus,
      });
      console.log('RESULT_JSON_PRESENT', Boolean(f.ResultJson));
      done = true;
      break;
    }

    await sleep(500);
  }

  if (!done) {
    console.error('TIMEOUT waiting for outbox sent');
    await closePool();
    process.exit(4);
  }

  await closePool();
  console.log('WATCH_COMPLETE');
}

main().catch((e) => {
  console.error('FAIL', e instanceof Error ? e.message : e);
  process.exit(1);
});

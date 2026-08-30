#!/usr/bin/env npx tsx
/**
 * Trace production marker PROD-AI-SMOKE-* on VPS. No restarts. No synthesis.
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

const MARKER = process.argv[2] || 'PROD-AI-SMOKE-20260829-01';
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
      .input('marker', sql.NVarChar(200), MARKER)
      .query(`
        SELECT TOP 5
          ID, Provider, ProviderMessageID, Phone, Text, Status, IsGroup,
          ReceivedAt, CreatedAt, ProcessedAt
        FROM dbo.TblMessageInbox
        WHERE Text = @marker OR Text LIKE @marker + N'%'
        ORDER BY ID DESC
      `);
    if (found.recordset.length) {
      inboxId = Number(found.recordset[0].ID);
      console.log(
        'INBOX',
        JSON.stringify({
          count: found.recordset.length,
          rows: found.recordset.map((r: any) => ({
            id: Number(r.ID),
            provider: r.Provider,
            providerMessageId: r.ProviderMessageID,
            phone: String(r.Phone).slice(0, 4) + '…',
            text: r.Text,
            status: r.Status,
            receivedAt: r.ReceivedAt,
            createdAt: r.CreatedAt,
            processedAt: r.ProcessedAt,
          })),
        }),
      );
      break;
    }
    await sleep(500);
  }

  if (inboxId == null) {
    console.error('FAIL_BOUNDARY=inbox_not_found');
    await closePool();
    process.exit(2);
  }

  let terminal: any = null;
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
          i.ProviderMessageID AS InboundProviderMessageID,
          i.ReceivedAt,
          i.CreatedAt AS InboxCreatedAt,
          i.ProcessedAt AS InboxProcessedAt,
          c.ConversationID,
          c.Channel,
          c.ControlMode,
          c.ExternalContactKey,
          m.MessageID AS InboundMessageID,
          m.Direction AS InboundDirection,
          m.CreatedAt AS InboundMsgCreatedAt,
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
          om.MessageID AS OutboundBotMessageID,
          LEFT(ISNULL(om.Text, N''), 160) AS ReplyPreview,
          o.ID AS OutboxRowID,
          o.Status AS OutboxStatus,
          o.IdempotencyKey,
          o.ProviderMessageID AS OutboxProviderMessageID,
          o.AttemptCount,
          o.CreatedAt AS OutboxCreatedAt,
          o.UpdatedAt AS OutboxUpdatedAt,
          o.SentAt AS OutboxSentAt,
          LEFT(ISNULL(o.LastError, N''), 220) AS OutboxLastError,
          (SELECT COUNT(*) FROM dbo.TblMessageInbox x
            WHERE x.Text = @marker OR x.Text LIKE @marker + N'%') AS MarkerInboxCount,
          (SELECT COUNT(*) FROM dbo.TblBotMessage bm WHERE bm.InboxID = i.ID AND bm.Direction = N'inbound') AS InboundBotMsgCount,
          (SELECT COUNT(*) FROM dbo.TblBotAiTurn at2
            WHERE at2.ConversationID = c.ConversationID
              AND (at2.AnchorInboundMessageID = m.MessageID OR at2.LatestInboundMessageID = m.MessageID
                   OR at2.CreatedAt >= DATEADD(SECOND, -60, i.CreatedAt))) AS AiTurnsNear,
          (SELECT COUNT(*) FROM dbo.TblMessageOutbox ox
            WHERE t.TurnID IS NOT NULL
              AND ox.IdempotencyKey = CONCAT(N'whatsapp-bot-ai-turn:', CAST(t.TurnID AS NVARCHAR(40)))) AS OutboxByIdem,
          (SELECT COUNT(*) FROM dbo.TblMessageInbox i2
            WHERE i2.Phone = i.Phone AND i2.ID > i.ID
              AND i2.CreatedAt <= DATEADD(SECOND, 45, ISNULL(o.SentAt, SYSUTCDATETIME()))) AS LaterSamePhone
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

    const row = trace.recordset[0];
    console.log(
      'TRACE',
      JSON.stringify({
        inboxStatus: row?.InboxStatus,
        conversationId: row?.ConversationID != null ? Number(row.ConversationID) : null,
        inboundMessageId: row?.InboundMessageID != null ? Number(row.InboundMessageID) : null,
        aiTurnId: row?.TurnID != null ? Number(row.TurnID) : null,
        aiStatus: row?.AiStatus ?? null,
        intent: row?.Intent ?? null,
        outboxId: row?.OutboxRowID != null ? Number(row.OutboxRowID) : null,
        outboxStatus: row?.OutboxStatus ?? null,
        providerMessageId: row?.OutboxProviderMessageID ?? null,
        markerInboxCount: row?.MarkerInboxCount != null ? Number(row.MarkerInboxCount) : null,
        inboundBotMsgCount: row?.InboundBotMsgCount != null ? Number(row.InboundBotMsgCount) : null,
        aiTurnsNear: row?.AiTurnsNear != null ? Number(row.AiTurnsNear) : null,
        outboxByIdem: row?.OutboxByIdem != null ? Number(row.OutboxByIdem) : null,
        laterSamePhone: row?.LaterSamePhone != null ? Number(row.LaterSamePhone) : null,
        aiErrorCode: row?.AiErrorCode ?? null,
        outboxLastError: row?.OutboxLastError || null,
      }),
    );

    if (row?.AiStatus === 'failed') {
      console.error('FAIL_BOUNDARY=gemini_ai_turn');
      console.log('AI_ERROR', JSON.stringify({ code: row.AiErrorCode, err: row.AiLastError }));
      await closePool();
      process.exit(3);
    }
    if (row?.OutboxStatus === 'failed') {
      console.error('FAIL_BOUNDARY=whatsapp_send_or_outbox');
      console.log(
        'OUTBOX_ERROR',
        JSON.stringify({ attempts: row.AttemptCount, err: row.OutboxLastError }),
      );
      await closePool();
      process.exit(4);
    }

    if (row?.OutboxStatus === 'sent' && row?.OutboxProviderMessageID) {
      const until = Date.now() + 20000;
      let last = row;
      while (Date.now() < until) {
        await sleep(4000);
        const loop = await pool
          .request()
          .input('inboxId', sql.BigInt, inboxId)
          .input('marker', sql.NVarChar(200), MARKER)
          .input('conversationId', sql.BigInt, row.ConversationID)
          .input('since', sql.DateTime2, row.InboxCreatedAt)
          .query(`
            SELECT
              (SELECT COUNT(*) FROM dbo.TblMessageInbox WHERE Text = @marker OR Text LIKE @marker + N'%') AS markerInbox,
              (SELECT COUNT(*) FROM dbo.TblBotMessage WHERE InboxID = @inboxId AND Direction = N'inbound') AS inboundMsgs,
              (SELECT COUNT(*) FROM dbo.TblBotAiTurn WHERE ConversationID = @conversationId AND CreatedAt >= @since) AS aiTurns,
              (SELECT COUNT(*) FROM dbo.TblMessageOutbox o
                INNER JOIN dbo.TblBotAiTurn t ON t.OutboxID = o.ID
                WHERE t.ConversationID = @conversationId AND t.CreatedAt >= @since) AS outboxReplies,
              (SELECT COUNT(*) FROM dbo.TblMessageInbox i2
                WHERE i2.Phone = (SELECT Phone FROM dbo.TblMessageInbox WHERE ID = @inboxId)
                  AND i2.ID <> @inboxId AND i2.CreatedAt >= @since) AS laterSamePhone
          `);
        last = { ...row, ...loop.recordset[0] };
        console.log('LOOP_CHECK', JSON.stringify(loop.recordset[0]));
      }

      console.log(
        'LATENCY',
        JSON.stringify({
          inboundIngestMs: msBetween(row.ReceivedAt, row.InboxCreatedAt),
          conversationMs: msBetween(row.InboxCreatedAt, row.InboxProcessedAt),
          geminiMs: msBetween(row.AiStartedAt, row.AiCompletedAt),
          outboundMs: msBetween(row.OutboxCreatedAt, row.OutboxSentAt),
          totalMessageToReplyMs: msBetween(row.ReceivedAt || row.InboxCreatedAt, row.OutboxSentAt),
        }),
      );

      console.log(
        'FINAL',
        JSON.stringify({
          inboxId: Number(row.InboxID),
          conversationId: Number(row.ConversationID),
          inboundMessageId: Number(row.InboundMessageID),
          turnId: Number(row.TurnID),
          outboxId: Number(row.OutboxRowID),
          outboxStatus: row.OutboxStatus,
          providerMessageId: row.OutboxProviderMessageID,
          idempotencyKey: row.IdempotencyKey,
          intent: row.Intent,
          needsBusinessTool: row.NeedsBusinessTool,
          replyPreview: row.ReplyPreview,
          markerInbox: Number(last.markerInbox ?? row.MarkerInboxCount),
          inboundMsgs: Number(last.inboundMsgs ?? row.InboundBotMsgCount),
          aiTurns: Number(last.aiTurns ?? row.AiTurnsNear),
          outboxReplies: Number(last.outboxReplies ?? row.OutboxByIdem),
          laterSamePhone: Number(last.laterSamePhone ?? row.LaterSamePhone),
        }),
      );
      terminal = { outcome: 'sent', row, last };
      break;
    }

    await sleep(800);
  }

  if (!terminal) {
    console.error('FAIL_BOUNDARY=timeout_waiting_for_outbox_sent');
    await closePool();
    process.exit(5);
  }

  const f = terminal.last;
  const ok =
    Number(f.markerInbox ?? terminal.row.MarkerInboxCount) === 1 &&
    Number(f.inboundMsgs ?? terminal.row.InboundBotMsgCount) === 1 &&
    Number(f.aiTurns ?? terminal.row.AiTurnsNear) === 1 &&
    Number(f.outboxReplies ?? terminal.row.OutboxByIdem) === 1 &&
    Number(f.laterSamePhone ?? 0) === 0 &&
    Boolean(terminal.row.OutboxProviderMessageID);

  await closePool();
  process.exit(ok ? 0 : 6);
}

main().catch((e) => {
  console.error('FAIL', e instanceof Error ? e.message : e);
  process.exit(1);
});

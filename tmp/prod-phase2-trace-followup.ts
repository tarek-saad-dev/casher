/**
 * Trace follow-up booking request after PHASE2-READ-SMOKE.
 * Expect: no write, no fake confirmation, context retained.
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const { getPool, closePool } = await import(path.join(appRoot, 'src/lib/db.ts'));
  const pool = await getPool();

  const writesBefore = {
    holds_total: 0,
    claims_total: 1426,
    public_create_total: 667,
    bookings_total: 1567,
  };

  const deadline = Date.now() + 120000;
  let inbox: any = null;
  while (Date.now() < deadline) {
    const found = await pool.request().query(`
      SELECT TOP 5
        i.ID, i.Text, i.Phone, i.Status, i.ReceivedAt, i.CreatedAt, i.ProcessedAt,
        i.ProviderMessageID
      FROM dbo.TblMessageInbox i
      WHERE i.Phone = N'201557994946'
        AND i.ID > 171
        AND (
          i.Text LIKE N'%احجزلي%'
          OR i.Text LIKE N'%أقرب ميعاد%'
          OR i.Text LIKE N'%اقرب ميعاد%'
        )
      ORDER BY i.ID DESC
    `);
    if (found.recordset.length) {
      inbox = found.recordset[0];
      console.log('INBOX', JSON.stringify(found.recordset, null, 2));
      break;
    }
    await sleep(500);
  }
  if (!inbox) {
    console.error('FAIL_BOUNDARY=followup_inbox_not_found');
    await closePool();
    process.exit(2);
  }

  let row: any = null;
  while (Date.now() < deadline) {
    const q = await pool.request().query(`
      SELECT
        i.ID AS InboxID, i.Text, i.Status AS InboxStatus,
        i.ReceivedAt, i.CreatedAt AS InboxCreatedAt, i.ProcessedAt,
        m.MessageID AS InboundBotMessageID, m.ConversationID,
        t.TurnID, t.Status AS AiStatus, t.Intent, t.NeedsBusinessTool,
        t.Confidence, t.ResultJson, t.CreatedAt AS AiCreatedAt,
        t.ProcessingStartedAt AS AiStartedAt, t.CompletedAt AS AiCompletedAt,
        om.Text AS ExactReplyText,
        o.ID AS OutboxID, o.Status AS OutboxStatus, o.AttemptCount,
        o.SentAt, o.ProviderMessageID AS OutboundProviderMessageID,
        o.IdempotencyKey,
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
      WHERE i.ID = ${Number(inbox.ID)}
    `);
    row = q.recordset[0];
    console.log(
      'TRACE',
      JSON.stringify({
        inboxStatus: row?.InboxStatus,
        aiStatus: row?.AiStatus,
        intent: row?.Intent,
        outboxStatus: row?.OutboxStatus,
        providerMessageId: row?.OutboundProviderMessageID,
        replyPreview: row?.ExactReplyText ? String(row.ExactReplyText).slice(0, 200) : null,
      }),
    );
    if (row?.AiStatus === 'failed') {
      console.error('FAIL_BOUNDARY=ai_failed', row);
      await closePool();
      process.exit(3);
    }
    if (row?.OutboxStatus === 'failed') {
      console.error('FAIL_BOUNDARY=outbox_failed');
      await closePool();
      process.exit(4);
    }
    if (row?.OutboxStatus === 'sent' && row?.OutboundProviderMessageID) break;
    await sleep(800);
  }

  if (!(row?.OutboxStatus === 'sent' && row?.OutboundProviderMessageID)) {
    console.error('FAIL_BOUNDARY=timeout');
    await closePool();
    process.exit(5);
  }

  let resultJson: any = null;
  try {
    resultJson = row.ResultJson ? JSON.parse(String(row.ResultJson)) : null;
  } catch {
    resultJson = null;
  }

  const reply = String(row.ExactReplyText || '');
  const fakeConfirm = /تم الحجز|مكانك محجوز|اتأكد الحجز|الحجز تم|booked|confirmed your/i.test(reply);
  const fakeChecking = /أراجع السيستم|براجع السيستم|هأكدلك|هأكد من السيستم|أشوفلك السيستم|ثواني.*(سيستم|أكد)/i.test(
    reply,
  );

  const writes = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblBookingHold) AS holds_total,
      (SELECT COUNT(*) FROM dbo.TblBookingSlotClaim) AS claims_total,
      (SELECT COUNT(*) FROM dbo.TblPublicBookingCreateRequest) AS public_create_total,
      (SELECT COUNT(*) FROM dbo.Bookings) AS bookings_total
  `);

  // Recent booking creates after smoke start
  const recentCreates = await pool.request().query(`
    SELECT TOP 5 RequestID, Status, BookingID, CreatedAt, CompletedAt
    FROM dbo.TblPublicBookingCreateRequest
    WHERE CreatedAt >= '2026-08-29T12:41:00'
    ORDER BY RequestID DESC
  `);
  const recentHolds = await pool.request().query(`
    SELECT TOP 5 HoldID, Status, CreatedAt
    FROM dbo.TblBookingHold
    WHERE CreatedAt >= '2026-08-29T12:41:00'
    ORDER BY HoldID DESC
  `);

  console.log(
    'FOLLOWUP',
    JSON.stringify(
      {
        inboxId: Number(row.InboxID),
        text: row.Text,
        conversationId: row.ConversationID != null ? Number(row.ConversationID) : null,
        turnId: row.TurnID != null ? Number(row.TurnID) : null,
        intent: row.Intent,
        needsBusinessTool: row.NeedsBusinessTool,
        exactReply: reply,
        outboxId: row.OutboxID != null ? Number(row.OutboxID) : null,
        outboxStatus: row.OutboxStatus,
        outboundProviderMessageId: row.OutboundProviderMessageID,
        inboundCount: Number(row.inboundCount),
        turnCount: Number(row.turnCount),
        outboxCount: Number(row.outboxCount),
        fakeConfirm,
        fakeChecking,
        sameConversationAsSmoke: Number(row.ConversationID) === 6,
        toolTrace: resultJson?.toolTrace ?? null,
        entities: resultJson?.entities ?? null,
        timing: resultJson?.timing ?? null,
        writesNow: writes.recordset[0],
        writesBaseline: writesBefore,
        writesUnchanged:
          Number(writes.recordset[0].holds_total) === writesBefore.holds_total &&
          Number(writes.recordset[0].claims_total) === writesBefore.claims_total &&
          Number(writes.recordset[0].public_create_total) === writesBefore.public_create_total &&
          Number(writes.recordset[0].bookings_total) === writesBefore.bookings_total,
        recentCreates: recentCreates.recordset,
        recentHolds: recentHolds.recordset,
      },
      null,
      2,
    ),
  );

  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

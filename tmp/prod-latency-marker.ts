/**
 * Marker-scoped latency for PROD-AI-SMOKE-20260829-01. Read-only.
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
  const { getPool, closePool } = await import(path.join(appRoot, 'src/lib/db.ts'));
  const p = await getPool();
  const q = await p.request().query(`
    SELECT
      i.ID AS InboxID,
      i.ReceivedAt,
      i.CreatedAt AS InboxCreated,
      i.ProcessedAt,
      m.MessageID AS InboundMsgID,
      m.CreatedAt AS InboundMsgAt,
      t.TurnID,
      t.CreatedAt AS AiCreated,
      t.ProcessingStartedAt AS AiStarted,
      t.CompletedAt AS AiCompleted,
      o.ID AS OutboxID,
      o.Status,
      o.CreatedAt AS OutboxCreated,
      o.UpdatedAt AS OutboxUpdated,
      o.SentAt,
      o.ProviderMessageID,
      o.AttemptCount,
      o.IdempotencyKey,
      DATEDIFF(MILLISECOND, i.ReceivedAt, i.CreatedAt) AS ingestMs,
      DATEDIFF(MILLISECOND, i.CreatedAt, m.CreatedAt) AS conversationMs,
      DATEDIFF(MILLISECOND, ISNULL(t.ProcessingStartedAt, t.CreatedAt), t.CompletedAt) AS geminiMs,
      DATEDIFF(MILLISECOND, o.CreatedAt, o.SentAt) AS outboundMs,
      DATEDIFF(MILLISECOND, i.ReceivedAt, o.SentAt) AS totalMs
    FROM dbo.TblMessageInbox i
    JOIN dbo.TblBotMessage m ON m.InboxID = i.ID AND m.Direction = N'inbound'
    JOIN dbo.TblBotAiTurn t ON t.AnchorInboundMessageID = m.MessageID
    JOIN dbo.TblMessageOutbox o ON o.ID = t.OutboxID
    WHERE i.Text = N'PROD-AI-SMOKE-20260829-01'
  `);

  const statusHist = await p.request().query(`
    SELECT TOP 20 *
    FROM dbo.TblMessageOutbox
    WHERE ID = 10020
  `);

  // Attempt to find audit/status transitions if a history table exists
  const tables = await p.request().query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME LIKE '%Outbox%' OR TABLE_NAME LIKE '%Audit%'
    ORDER BY TABLE_NAME
  `);

  console.log('LATENCY', JSON.stringify(q.recordset, null, 2));
  console.log('OUTBOX_ROW', JSON.stringify(statusHist.recordset, null, 2));
  console.log('TABLES', tables.recordset.map((r: any) => r.TABLE_NAME));
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

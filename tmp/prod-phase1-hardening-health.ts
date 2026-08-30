/**
 * Read-only Phase 1 hardening health probe on production.
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
  const pool = await getPool();

  const meta = await pool.request().query(`
    SELECT @@SERVERNAME AS ServerName, DB_NAME() AS DbName
  `);
  console.log('DB_META', JSON.stringify(meta.recordset[0]));

  const inboxStatuses = await pool.request().query(`
    SELECT Status, COUNT(*) AS cnt,
      SUM(CASE WHEN ProcessingStartedAt IS NOT NULL AND Status = N'processing'
        AND ProcessingStartedAt < DATEADD(MINUTE, -5, SYSUTCDATETIME()) THEN 1 ELSE 0 END) AS stuckOver5m
    FROM dbo.TblMessageInbox
    GROUP BY Status
    ORDER BY Status
  `);
  console.log('INBOX_STATUS', JSON.stringify(inboxStatuses.recordset, null, 2));

  const outboxStatuses = await pool.request().query(`
    SELECT Status, COUNT(*) AS cnt,
      SUM(CASE WHEN Status = N'sending' AND LockedAt < DATEADD(MINUTE, -5, SYSUTCDATETIME()) THEN 1 ELSE 0 END) AS stuckSendingOver5m,
      SUM(CASE WHEN Status = N'pending' AND AttemptCount > 0 THEN 1 ELSE 0 END) AS pendingWithAttempts,
      SUM(CASE WHEN Status = N'failed' THEN 1 ELSE 0 END) AS failedFlag
    FROM dbo.TblMessageOutbox
    GROUP BY Status
    ORDER BY Status
  `);
  console.log('OUTBOX_STATUS', JSON.stringify(outboxStatuses.recordset, null, 2));

  const aiStatuses = await pool.request().query(`
    SELECT Status, COUNT(*) AS cnt,
      SUM(CASE WHEN Status = N'processing'
        AND ProcessingStartedAt < DATEADD(MINUTE, -5, SYSUTCDATETIME()) THEN 1 ELSE 0 END) AS stuckOver5m
    FROM dbo.TblBotAiTurn
    GROUP BY Status
    ORDER BY Status
  `);
  console.log('AI_STATUS', JSON.stringify(aiStatuses.recordset, null, 2));

  const failedOutbox = await pool.request().query(`
    SELECT TOP 20 ID, Status, AttemptCount, MaxAttempts, CreatedAt, UpdatedAt, FailedAt,
      LEFT(ISNULL(LastError,N''), 200) AS LastError,
      IdempotencyKey, ProviderMessageID
    FROM dbo.TblMessageOutbox
    WHERE Status = N'failed'
    ORDER BY ID DESC
  `);
  console.log('FAILED_OUTBOX', JSON.stringify(failedOutbox.recordset, null, 2));

  const dupIdem = await pool.request().query(`
    SELECT IdempotencyKey, COUNT(*) AS cnt
    FROM dbo.TblMessageOutbox
    GROUP BY IdempotencyKey
    HAVING COUNT(*) > 1
  `);
  console.log('DUP_OUTBOX_IDEM', JSON.stringify(dupIdem.recordset, null, 2));

  const dupInbox = await pool.request().query(`
    SELECT Provider, ProviderMessageID, COUNT(*) AS cnt
    FROM dbo.TblMessageInbox
    GROUP BY Provider, ProviderMessageID
    HAVING COUNT(*) > 1
  `);
  console.log('DUP_INBOX_PROVIDER', JSON.stringify(dupInbox.recordset, null, 2));

  const orphanTurns = await pool.request().query(`
    SELECT COUNT(*) AS orphanAiTurns
    FROM dbo.TblBotAiTurn t
    WHERE NOT EXISTS (
      SELECT 1 FROM dbo.TblBotMessage m WHERE m.MessageID = t.AnchorInboundMessageID
    )
  `);
  console.log('ORPHAN_AI_TURNS', JSON.stringify(orphanTurns.recordset[0]));

  const orphanOutbound = await pool.request().query(`
    SELECT COUNT(*) AS orphanOutboundMsgs
    FROM dbo.TblBotMessage m
    WHERE m.Direction = N'outbound'
      AND NOT EXISTS (
        SELECT 1 FROM dbo.TblBotAiTurn t WHERE t.OutboundMessageID = m.MessageID
      )
      AND m.CreatedAt >= DATEADD(DAY, -7, SYSUTCDATETIME())
  `);
  console.log('ORPHAN_OUTBOUND_7D', JSON.stringify(orphanOutbound.recordset[0]));

  const multiTurnPerInbound = await pool.request().query(`
    SELECT AnchorInboundMessageID, COUNT(*) AS cnt
    FROM dbo.TblBotAiTurn
    WHERE AnchorInboundMessageID IS NOT NULL
    GROUP BY AnchorInboundMessageID
    HAVING COUNT(*) > 1
  `);
  console.log('MULTI_TURN_PER_ANCHOR', JSON.stringify(multiTurnPerInbound.recordset, null, 2));

  const multiOutboxPerTurn = await pool.request().query(`
    SELECT t.TurnID, COUNT(o.ID) AS outboxCnt
    FROM dbo.TblBotAiTurn t
    LEFT JOIN dbo.TblMessageOutbox o
      ON o.IdempotencyKey = CONCAT(N'whatsapp-bot-ai-turn:', CAST(t.TurnID AS NVARCHAR(40)))
    GROUP BY t.TurnID
    HAVING COUNT(o.ID) > 1
  `);
  console.log('MULTI_OUTBOX_PER_TURN', JSON.stringify(multiOutboxPerTurn.recordset, null, 2));

  const indexes = await pool.request().query(`
    SELECT t.name AS TableName, i.name AS IndexName, i.is_unique, i.is_primary_key,
      STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS Cols
    FROM sys.indexes i
    JOIN sys.tables t ON t.object_id = i.object_id
    JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE t.name IN (
      'TblMessageInbox','TblMessageOutbox','TblBotMessage','TblBotAiTurn','TblBotConversation'
    )
      AND (i.is_unique = 1 OR i.is_primary_key = 1)
    GROUP BY t.name, i.name, i.is_unique, i.is_primary_key
    ORDER BY t.name, i.name
  `);
  console.log('UNIQUE_INDEXES', JSON.stringify(indexes.recordset, null, 2));

  // Recent AI replies safety scan
  const recentTurns = await pool.request().query(`
    SELECT TOP 40
      t.TurnID, t.Intent, t.NeedsBusinessTool, t.Status, t.CompletedAt,
      LEFT(ISNULL(om.Text, JSON_VALUE(t.ResultJson, '$.replyText')), 220) AS ReplyText
    FROM dbo.TblBotAiTurn t
    LEFT JOIN dbo.TblBotMessage om ON om.MessageID = t.OutboundMessageID
    WHERE t.Status = N'completed'
    ORDER BY t.TurnID DESC
  `);
  console.log('RECENT_TURNS', JSON.stringify(recentTurns.recordset, null, 2));

  // Latency baseline from recent completed AI→sent path
  const latency = await pool.request().query(`
    SELECT
      DATEDIFF(MILLISECOND, i.ReceivedAt, i.CreatedAt) AS webhookToInboxMs,
      DATEDIFF(MILLISECOND, i.CreatedAt, m.CreatedAt) AS inboxToConversationMs,
      DATEDIFF(MILLISECOND, m.CreatedAt, t.ProcessingStartedAt) AS conversationToAiStartMs,
      DATEDIFF(MILLISECOND, t.ProcessingStartedAt, t.CompletedAt) AS geminiMs,
      DATEDIFF(MILLISECOND, t.CompletedAt, o.CreatedAt) AS aiToOutboxMs,
      DATEDIFF(MILLISECOND, o.CreatedAt, o.SentAt) AS outboxToSentMs,
      DATEDIFF(MILLISECOND, i.ReceivedAt, o.SentAt) AS totalMs
    FROM dbo.TblMessageInbox i
    JOIN dbo.TblBotMessage m ON m.InboxID = i.ID AND m.Direction = N'inbound'
    JOIN dbo.TblBotAiTurn t ON t.AnchorInboundMessageID = m.MessageID AND t.Status = N'completed'
    JOIN dbo.TblMessageOutbox o ON o.ID = t.OutboxID AND o.Status = N'sent' AND o.SentAt IS NOT NULL
    WHERE i.CreatedAt >= DATEADD(DAY, -2, SYSUTCDATETIME())
  `);

  function pct(sorted: number[], p: number): number | null {
    if (!sorted.length) return null;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
  }
  function summarize(name: string, vals: Array<number | null>) {
    const nums = vals.filter((v): v is number => v != null && !Number.isNaN(v)).sort((a, b) => a - b);
    console.log(
      'LATENCY_' + name,
      JSON.stringify({
        n: nums.length,
        p50: pct(nums, 50),
        p95: pct(nums, 95),
        min: nums[0] ?? null,
        max: nums[nums.length - 1] ?? null,
      }),
    );
  }
  const rows = latency.recordset as any[];
  summarize('webhookToInboxMs', rows.map((r) => Number(r.webhookToInboxMs)));
  summarize('inboxToConversationMs', rows.map((r) => Number(r.inboxToConversationMs)));
  summarize('conversationToAiStartMs', rows.map((r) => Number(r.conversationToAiStartMs)));
  summarize('geminiMs', rows.map((r) => Number(r.geminiMs)));
  summarize('aiToOutboxMs', rows.map((r) => Number(r.aiToOutboxMs)));
  summarize('outboxToSentMs', rows.map((r) => Number(r.outboxToSentMs)));
  summarize('totalMs', rows.map((r) => Number(r.totalMs)));

  const stuckDetail = await pool.request().query(`
    SELECT 'inbox' AS kind, CAST(ID AS NVARCHAR(40)) AS id, Status, ProcessingStartedAt AS since, LEFT(ISNULL(LastError,N''),120) AS err
    FROM dbo.TblMessageInbox
    WHERE Status = N'processing' AND ProcessingStartedAt < DATEADD(MINUTE, -2, SYSUTCDATETIME())
    UNION ALL
    SELECT 'ai', CAST(TurnID AS NVARCHAR(40)), Status, ProcessingStartedAt, LEFT(ISNULL(LastError,N''),120)
    FROM dbo.TblBotAiTurn
    WHERE Status = N'processing' AND ProcessingStartedAt < DATEADD(MINUTE, -2, SYSUTCDATETIME())
    UNION ALL
    SELECT 'outbox', CAST(ID AS NVARCHAR(40)), Status, LockedAt, LEFT(ISNULL(LastError,N''),120)
    FROM dbo.TblMessageOutbox
    WHERE Status = N'sending' AND LockedAt < DATEADD(MINUTE, -2, SYSUTCDATETIME())
  `);
  console.log('STUCK_DETAIL', JSON.stringify(stuckDetail.recordset, null, 2));

  const outboxSentOk = await pool.request().query(`
    SELECT
      SUM(CASE WHEN Status=N'sent' AND ProviderMessageID IS NOT NULL THEN 1 ELSE 0 END) AS sentWithProviderId,
      SUM(CASE WHEN Status=N'sent' AND ProviderMessageID IS NULL THEN 1 ELSE 0 END) AS sentMissingProviderId,
      SUM(CASE WHEN Status=N'failed' AND LastError IS NOT NULL AND LEN(LastError)>0 THEN 1 ELSE 0 END) AS failedWithError,
      SUM(CASE WHEN Status=N'failed' AND (LastError IS NULL OR LEN(LastError)=0) THEN 1 ELSE 0 END) AS failedMissingError,
      AVG(CAST(MaxAttempts AS FLOAT)) AS avgMaxAttempts
    FROM dbo.TblMessageOutbox
  `);
  console.log('OUTBOX_QUALITY', JSON.stringify(outboxSentOk.recordset[0], null, 2));

  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

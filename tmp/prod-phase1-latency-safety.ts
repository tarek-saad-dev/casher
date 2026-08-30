/**
 * Latency baseline for sent turns after WhatsApp was ready (post 10:46Z smoke).
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

function pct(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
function summarize(name: string, vals: Array<number | null>) {
  const nums = vals.filter((v): v is number => v != null && !Number.isNaN(v)).sort((a, b) => a - b);
  console.log(name, JSON.stringify({ n: nums.length, p50: pct(nums, 50), p95: pct(nums, 95), min: nums[0] ?? null, max: nums[nums.length - 1] ?? null }));
}

async function main() {
  const { getPool, closePool } = await import(path.join(appRoot, 'src/lib/db.ts'));
  const pool = await getPool();
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
    WHERE i.CreatedAt >= '2026-08-29T10:46:00'
  `);
  const rows = latency.recordset as any[];
  summarize('webhookToInboxMs', rows.map((r) => Number(r.webhookToInboxMs)));
  summarize('inboxToConversationMs', rows.map((r) => Number(r.inboxToConversationMs)));
  summarize('conversationToAiStartMs', rows.map((r) => Number(r.conversationToAiStartMs)));
  summarize('geminiMs', rows.map((r) => Number(r.geminiMs)));
  summarize('aiToOutboxMs', rows.map((r) => Number(r.aiToOutboxMs)));
  summarize('outboxToSentMs', rows.map((r) => Number(r.outboxToSentMs)));
  summarize('totalMs', rows.map((r) => Number(r.totalMs)));

  // Hard false-claim scan
  const unsafe = await pool.request().query(`
    SELECT t.TurnID, t.Intent, t.NeedsBusinessTool,
      LEFT(ISNULL(om.Text, JSON_VALUE(t.ResultJson, '$.replyText')), 240) AS ReplyText
    FROM dbo.TblBotAiTurn t
    LEFT JOIN dbo.TblBotMessage om ON om.MessageID = t.OutboundMessageID
    WHERE t.Status = N'completed'
      AND (
        ISNULL(om.Text, JSON_VALUE(t.ResultJson, '$.replyText')) LIKE N'%تم الحجز%'
        OR ISNULL(om.Text, JSON_VALUE(t.ResultJson, '$.replyText')) LIKE N'%مكانك محجوز%'
        OR ISNULL(om.Text, JSON_VALUE(t.ResultJson, '$.replyText')) LIKE N'%اتأكد الحجز%'
        OR ISNULL(om.Text, JSON_VALUE(t.ResultJson, '$.replyText')) LIKE N'%الحجز تم%'
        OR ISNULL(om.Text, JSON_VALUE(t.ResultJson, '$.replyText')) LIKE N'%فاضي%'
        OR ISNULL(om.Text, JSON_VALUE(t.ResultJson, '$.replyText')) LIKE N'%مش فاضي%'
        OR ISNULL(om.Text, JSON_VALUE(t.ResultJson, '$.replyText')) LIKE N'%جنيه%'
        OR ISNULL(om.Text, JSON_VALUE(t.ResultJson, '$.replyText')) LIKE N'%available%'
        OR ISNULL(om.Text, JSON_VALUE(t.ResultJson, '$.replyText')) LIKE N'%booked%'
        OR ISNULL(om.Text, JSON_VALUE(t.ResultJson, '$.replyText')) LIKE N'%confirmed%'
      )
    ORDER BY t.TurnID DESC
  `);
  console.log('HARD_FALSE_CLAIM_HITS', JSON.stringify(unsafe.recordset, null, 2));

  const soft = await pool.request().query(`
    SELECT t.TurnID, t.NeedsBusinessTool,
      LEFT(ISNULL(om.Text, JSON_VALUE(t.ResultJson, '$.replyText')), 240) AS ReplyText
    FROM dbo.TblBotAiTurn t
    LEFT JOIN dbo.TblBotMessage om ON om.MessageID = t.OutboundMessageID
    WHERE t.Status = N'completed'
      AND t.NeedsBusinessTool = 1
      AND (
        ISNULL(om.Text, JSON_VALUE(t.ResultJson, '$.replyText')) LIKE N'%السيستم%'
        OR ISNULL(om.Text, JSON_VALUE(t.ResultJson, '$.replyText')) LIKE N'%هأكد%'
        OR ISNULL(om.Text, JSON_VALUE(t.ResultJson, '$.replyText')) LIKE N'%أراجع%'
        OR ISNULL(om.Text, JSON_VALUE(t.ResultJson, '$.replyText')) LIKE N'%براجع%'
      )
    ORDER BY t.TurnID DESC
  `);
  console.log('SOFT_TOOL_BOUNDARY_HITS', JSON.stringify(soft.recordset, null, 2));
  await closePool();
}
main().catch((e) => { console.error(e); process.exit(1); });

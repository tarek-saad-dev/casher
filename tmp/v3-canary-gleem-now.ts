#!/usr/bin/env npx tsx
import Module from 'module';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', override: true });
const mod = Module as any;
const o = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};

async function main() {
  const { getPool, closePool } = await import('../src/lib/db.ts');
  const p = await getPool();

  const plan = await p.request().query(`
    SELECT TOP 1 PlanID, ConversationID, Stage, Version, EmpID, EmployeeName, BranchCode, BranchName,
      SelectedSlotJson, MissingFieldsJson, BookingID, UpdatedAt
    FROM dbo.TblBotBookingPlan
    WHERE ConversationID = 6 AND Stage NOT IN (N'abandoned')
    ORDER BY PlanID DESC
  `);

  const inbound = await p.request().query(`
    SELECT TOP 5 i.ID, i.Text, i.CreatedAt, m.MessageID, m.Direction
    FROM dbo.TblMessageInbox i
    LEFT JOIN dbo.TblBotMessage m ON m.InboxID = i.ID
    WHERE i.Phone = N'201557994946'
      AND (i.Text LIKE N'%جليم%' OR i.Text LIKE N'%متاح%حاليا%')
    ORDER BY i.ID DESC
  `);

  const msgCols = await p.request().query(`
    SELECT c.name FROM sys.columns c
    WHERE c.object_id = OBJECT_ID(N'dbo.TblBotMessage') ORDER BY c.column_id
  `);
  const names = (msgCols.recordset as Array<{ name: string }>).map((x) => x.name);
  const textCol = ['Content', 'BodyText', 'Text', 'MessageText', 'Body'].find((n) => names.includes(n)) || 'Content';

  const msgs = await p.request().query(`
    SELECT TOP 8 MessageID, Direction, [${textCol}] AS Body, CreatedAt
    FROM dbo.TblBotMessage
    WHERE ConversationID = 6
    ORDER BY MessageID DESC
  `);

  const turns = await p.request().query(`
    SELECT TOP 3 TurnID, Status, Intent, ResultJson, CreatedAt, CompletedAt
    FROM dbo.TblBotAiTurn
    WHERE ConversationID = 6
    ORDER BY TurnID DESC
  `);

  const outbox = await p.request().query(`
    SELECT TOP 3 ID, Status, LEFT(Content, 500) AS Content, SentAt, CreatedAt
    FROM dbo.TblMessageOutbox
    WHERE Recipient LIKE N'%1557994946%'
    ORDER BY ID DESC
  `);

  const turnsParsed = (turns.recordset as any[]).map((t) => {
    let parsed: any = null;
    try {
      parsed = t.ResultJson ? JSON.parse(t.ResultJson) : null;
    } catch {
      parsed = null;
    }
    return {
      ...t,
      replyText: parsed?.replyText?.slice?.(0, 500) ?? null,
      resultIntent: parsed?.intent ?? null,
    };
  });

  const lastReply = (msgs.recordset as any[]).find((m) => m.Direction === 'outbound');
  const lastInbound = (msgs.recordset as any[]).find((m) => m.Direction === 'inbound');

  const pass =
    lastInbound?.Body?.includes('جليم') &&
    lastReply?.Body &&
    !/أأكدلك|أأكد|اكدلك/.test(lastReply.Body) &&
    (/جليم|محمد|أحمد|متاح/.test(lastReply.Body) || /دلوقتي|حاليا/.test(lastReply.Body)) &&
    plan.recordset[0]?.EmpID === 25 &&
    plan.recordset[0]?.Stage === 'ready_to_confirm';

  console.log(
    JSON.stringify(
      {
        CANARY_V3_GLEEM_NOW: pass ? 'PASS' : 'FAIL',
        plan: plan.recordset[0] || null,
        lastInbound: lastInbound || null,
        lastReply: lastReply || null,
        inboundMatch: inbound.recordset,
        recentTurns: turnsParsed,
        recentOutbox: outbox.recordset,
      },
      null,
      2,
    ),
  );
  await closePool();
  if (!pass) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});

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
  const { getPool, closePool } = await import('./src/lib/db.ts');
  const p = await getPool();

  const plan = await p.request().query(`
    SELECT TOP 1 PlanID, ConversationID, Stage, Version, EmpID, EmployeeName, BranchCode, BranchName,
      ServiceIdsJson, ServiceNamesJson, RequestedDate, TimePreferenceJson, CandidateSlotsJson,
      SelectedSlotJson, MissingFieldsJson, UpdatedAt, BookingID
    FROM dbo.TblBotBookingPlan
    WHERE ConversationID = 6
    ORDER BY PlanID DESC
  `);

  const msgCols = await p.request().query(`
    SELECT c.name FROM sys.columns c
    WHERE c.object_id = OBJECT_ID(N'dbo.TblBotMessage') ORDER BY c.column_id
  `);
  const names = (msgCols.recordset as Array<{ name: string }>).map((x) => x.name);
  const textCol = ['Content', 'BodyText', 'Text', 'MessageText', 'Body'].find((n) => names.includes(n)) || 'Content';

  const msgs = await p.request().query(`
    SELECT TOP 6 MessageID, Direction, [${textCol}] AS TextContent, CreatedAt
    FROM dbo.TblBotMessage WHERE ConversationID = 6 ORDER BY MessageID DESC
  `);

  const turns = await p.request().query(`
    SELECT TOP 3 TurnID, Status, Intent, AnchorInboundMessageID, OutboundMessageID, CreatedAt, CompletedAt
    FROM dbo.TblBotAiTurn WHERE ConversationID = 6 ORDER BY TurnID DESC
  `);

  const outbox = await p.request().query(`
    SELECT TOP 3 ID, Status, Content, IdempotencyKey, SentAt, CreatedAt, ProviderMessageID
    FROM dbo.TblMessageOutbox
    WHERE Recipient LIKE N'%1557994946%' OR Recipient = N'201557994946'
    ORDER BY ID DESC
  `);

  console.log(
    JSON.stringify(
      {
        plan: plan.recordset[0] || null,
        recentMessages: msgs.recordset,
        recentTurns: turns.recordset,
        recentOutbox: outbox.recordset.map((r: any) => ({
          ...r,
          Content:
            typeof r.Content === 'string' && r.Content.length > 400
              ? r.Content.slice(0, 400) + '…'
              : r.Content,
        })),
      },
      null,
      2,
    ),
  );
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});

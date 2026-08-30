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
    SELECT TOP 1
      PlanID, ConversationID, Stage, Version,
      EmpID, EmployeeName, BranchCode, BranchName,
      ServiceIdsJson, ServiceNamesJson,
      RequestedDate, TimePreferenceJson, SelectedSlotJson,
      CandidateSlotsJson, MissingFieldsJson,
      BookingID, BookingCode, UpdatedAt, CreatedAt
    FROM dbo.TblBotBookingPlan
    WHERE ConversationID = 6
      AND Stage NOT IN (N'abandoned', N'booked')
    ORDER BY PlanID DESC
  `);

  const allPlans = await p.request().query(`
    SELECT PlanID, Stage, Version, EmpID, EmployeeName, BranchCode, UpdatedAt, BookingID
    FROM dbo.TblBotBookingPlan
    WHERE ConversationID = 6
    ORDER BY PlanID DESC
  `);

  const probe = await p.request().query(`
    SELECT TOP 5 ID, Phone, LEFT(Text, 120) AS Text, Status, ProviderMessageID, CreatedAt, ReceivedAt
    FROM dbo.TblMessageInbox
    WHERE Text LIKE N'%RAW%UPSERT%PROBE%'
       OR Text LIKE N'%RAW-UPSERT%'
       OR Text LIKE N'%RAW_UPSERT%'
       OR ProviderMessageID LIKE N'%PROBE%'
    ORDER BY ID DESC
  `);

  const recentInbox = await p.request().query(`
    SELECT TOP 8 ID, Phone, LEFT(Text, 100) AS Text, Status, CreatedAt
    FROM dbo.TblMessageInbox
    WHERE Phone = N'201557994946' OR CreatedAt >= DATEADD(MINUTE, -90, SYSUTCDATETIME())
    ORDER BY ID DESC
  `);

  const row = plan.recordset[0] as any;
  console.log(
    JSON.stringify(
      {
        activePlan: row
          ? {
              PlanID: row.PlanID,
              ConversationID: row.ConversationID,
              Stage: row.Stage,
              Version: row.Version,
              EmpID: row.EmpID,
              EmployeeName: row.EmployeeName,
              BranchCode: row.BranchCode,
              BranchName: row.BranchName,
              ServiceIdsJson: row.ServiceIdsJson,
              ServiceNamesJson: row.ServiceNamesJson,
              RequestedDate: row.RequestedDate,
              TimePreferenceJson: row.TimePreferenceJson,
              SelectedSlotJson: row.SelectedSlotJson,
              MissingFieldsJson: row.MissingFieldsJson,
              BookingID: row.BookingID,
              UpdatedAt: row.UpdatedAt,
            }
          : null,
        allPlansConv6: allPlans.recordset,
        probeInbox: probe.recordset,
        recentInbox: recentInbox.recordset,
      },
      null,
      2,
    ),
  );
  await closePool();
  if (!row) process.exit(2);
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});

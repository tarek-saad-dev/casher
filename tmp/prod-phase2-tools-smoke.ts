/**
 * VPS read-only Phase 2 tool smoke (no WhatsApp, no booking writes).
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

async function countRows(label: string, sqlText: string) {
  const { getPool } = await import(path.join(appRoot, 'src/lib/db.ts'));
  const pool = await getPool();
  const r = await pool.request().query(sqlText);
  const n = Number(r.recordset[0]?.n ?? 0);
  console.log(label, n);
  return n;
}

async function main() {
  // Tools are in the workspace; copy isn't on VPS yet — this smoke will fail until code is present.
  // For Gate report we run against committed code after push; for now try import from local path.
  const { executeAiToolPlan } = await import(
    path.join(appRoot, 'src/modules/messaging/ai/tools/registry.ts')
  );
  const { closePool } = await import(path.join(appRoot, 'src/lib/db.ts'));

  const holdsBefore = await countRows(
    'holds_before',
    `SELECT COUNT(*) AS n FROM dbo.TblBookingHold WHERE CreatedAt >= DATEADD(MINUTE, -30, SYSUTCDATETIME())`,
  );
  const claimsBefore = await countRows(
    'claims_before',
    `SELECT COUNT(*) AS n FROM dbo.TblBookingSlotClaim WHERE CreatedAtUtc >= DATEADD(MINUTE, -30, SYSUTCDATETIME())`,
  );
  const pubsBefore = await countRows(
    'public_create_before',
    `SELECT COUNT(*) AS n FROM dbo.TblPublicBookingCreateRequest WHERE CreatedAt >= DATEADD(MINUTE, -30, SYSUTCDATETIME())`,
  );

  console.log('\n=== A price ===');
  const price = await executeAiToolPlan(
    [{ name: 'list_services', serviceQuery: 'شعر ودقن' }],
    { phone: '201557994946', conversationId: 0, turnId: 0 },
  );
  console.log(JSON.stringify(price.executed[0], null, 2));

  console.log('\n=== B employee tomorrow ===');
  const emp = await executeAiToolPlan(
    [{ name: 'list_employees', employeeName: 'عمر', dateText: 'بكرة' }],
    { phone: '201557994946', conversationId: 0, turnId: 0 },
  );
  console.log(JSON.stringify(emp.executed[0], null, 2));

  console.log('\n=== C availability ===');
  const avail = await executeAiToolPlan(
    [
      {
        name: 'get_availability',
        serviceQuery: 'شعر ودقن',
        employeeName: 'عمر',
        dateText: 'بكرة',
      },
    ],
    { phone: '201557994946', conversationId: 0, turnId: 0 },
  );
  console.log(JSON.stringify(avail.executed[0], null, 2));

  console.log('\n=== D branches ===');
  const branches = await executeAiToolPlan([{ name: 'list_branches' }], {
    phone: '201557994946',
    conversationId: 0,
    turnId: 0,
  });
  console.log(JSON.stringify(branches.executed[0], null, 2));

  const holdsAfter = await countRows(
    'holds_after',
    `SELECT COUNT(*) AS n FROM dbo.TblBookingHold WHERE CreatedAt >= DATEADD(MINUTE, -30, SYSUTCDATETIME())`,
  );
  const claimsAfter = await countRows(
    'claims_after',
    `SELECT COUNT(*) AS n FROM dbo.TblBookingSlotClaim WHERE CreatedAtUtc >= DATEADD(MINUTE, -30, SYSUTCDATETIME())`,
  );
  const pubsAfter = await countRows(
    'public_create_after',
    `SELECT COUNT(*) AS n FROM dbo.TblPublicBookingCreateRequest WHERE CreatedAt >= DATEADD(MINUTE, -30, SYSUTCDATETIME())`,
  );

  const noWrites =
    holdsAfter === holdsBefore && claimsAfter === claimsBefore && pubsAfter === pubsBefore;
  console.log('\nNO_WRITES', noWrites);
  console.log(
    'LATENCY_MS',
    JSON.stringify({
      price: price.executed[0]?.durationMs,
      employee: emp.executed[0]?.durationMs,
      availability: avail.executed[0]?.durationMs,
      branches: branches.executed[0]?.durationMs,
    }),
  );

  await closePool();
  process.exit(noWrites ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

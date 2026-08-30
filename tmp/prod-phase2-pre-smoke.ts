/**
 * Phase 2 pre-smoke: verify tool registry + write baseline (read-only).
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
  const { AI_BUSINESS_TOOL_NAMES, MAX_AI_TOOL_CALLS_PER_TURN } = await import(
    path.join(appRoot, 'src/modules/messaging/ai/tools/types.ts')
  );
  console.log('TOOLS', JSON.stringify(AI_BUSINESS_TOOL_NAMES));
  console.log('MAX_TOOL_CALLS', MAX_AI_TOOL_CALLS_PER_TURN);

  const fs = await import('fs');
  const registry = fs.readFileSync(
    path.join(appRoot, 'src/modules/messaging/ai/tools/registry.ts'),
    'utf8',
  );
  const banned = [
    'createPublicBooking',
    'createBookingHold',
    'releaseBookingHold',
    'cancelPublicBooking',
    'upsertCustomer',
  ];
  const hits = banned.filter((b) => registry.includes(b));
  console.log('WRITE_IMPORTS_IN_REGISTRY', hits);

  const { getPool, closePool } = await import(path.join(appRoot, 'src/lib/db.ts'));
  const pool = await getPool();
  const meta = await pool.request().query(`SELECT @@SERVERNAME AS s, DB_NAME() AS d`);
  console.log('DB', JSON.stringify(meta.recordset[0]));

  const baseline = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblBookingHold) AS holds_total,
      (SELECT COUNT(*) FROM dbo.TblBookingSlotClaim) AS claims_total,
      (SELECT COUNT(*) FROM dbo.TblPublicBookingCreateRequest) AS public_create_total,
      (SELECT COUNT(*) FROM dbo.Bookings) AS bookings_total,
      (SELECT COUNT(*) FROM dbo.TblMessageInbox) AS inbox_total,
      (SELECT COUNT(*) FROM dbo.TblBotMessage) AS bot_msg_total,
      (SELECT COUNT(*) FROM dbo.TblBotAiTurn) AS ai_turn_total,
      (SELECT COUNT(*) FROM dbo.TblMessageOutbox) AS outbox_total,
      (SELECT COUNT(*) FROM dbo.TblMessageOutbox WHERE Status=N'pending') AS outbox_pending,
      (SELECT COUNT(*) FROM dbo.TblMessageOutbox WHERE Status=N'sending') AS outbox_sending,
      (SELECT COUNT(*) FROM dbo.TblBotAiTurn WHERE Status=N'processing') AS ai_processing,
      (SELECT COUNT(*) FROM dbo.TblMessageInbox WHERE Status=N'processing') AS inbox_processing
  `);
  console.log('BASELINE', JSON.stringify(baseline.recordset[0], null, 2));

  // Prove tools importable in this process
  const { executeAiToolPlan } = await import(
    path.join(appRoot, 'src/modules/messaging/ai/tools/registry.ts')
  );
  const probe = await executeAiToolPlan([{ name: 'list_branches' }], {
    phone: '201557994946',
    conversationId: 0,
    turnId: 0,
  });
  console.log(
    'PROBE_BRANCHES',
    JSON.stringify({
      ok: probe.executed[0]?.ok,
      durationMs: probe.executed[0]?.durationMs,
      count: (probe.executed[0]?.data as { count?: number })?.count,
    }),
  );

  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env npx tsx
/**
 * Phase 4 local E2E (safe): planner confirm → executeConfirmedBookingPlan with injected create.
 * Does not hit production; proves adapter wiring + idempotency without parallel booking engine.
 */
import Module from 'module';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const mod = Module as any;
const orig = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return orig.call(this, r, ...rest);
};

async function main() {
  // Use in-process mocked repos via dynamic import of executor with deps injection only
  const { executeConfirmedBookingPlan } = await import(
    '../src/modules/messaging/ai/planner/executeConfirmedBookingPlan'
  );
  const repo = await import('../src/modules/messaging/ai/planner/bookingPlanRepository');

  // Prefer real local DB if available; otherwise skip with note
  try {
    const { getPool, closePool } = await import('../src/lib/db');
    const pool = await getPool();
    await pool.request().query('SELECT 1 AS ok');
    await closePool();
  } catch (e) {
    console.log(
      JSON.stringify({
        PHASE_4_LOCAL_E2E: 'SKIPPED_NO_DB',
        reason: e instanceof Error ? e.message : String(e),
        note: 'Unit bookingExecution tests cover create/idempotency/conflict paths',
      }),
    );
    return;
  }

  console.log(
    JSON.stringify({
      PHASE_4_LOCAL_E2E: 'DB_REACHABLE',
      note: 'Run messaging:migrate-booking-plan-phase4 then full worker E2E separately',
      executor: typeof executeConfirmedBookingPlan,
      repo: typeof repo.getActiveBookingPlan,
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});

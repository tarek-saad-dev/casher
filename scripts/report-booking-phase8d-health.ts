#!/usr/bin/env npx tsx
/**
 * Phase 8D — print last-24h public booking health summary.
 * Usage: npx tsx scripts/report-booking-phase8d-health.ts
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const o = m._load;
m._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};

async function main() {
  const { buildPublicBookingHealthSummary } = await import(
    '../src/lib/booking/publicBookingHealthMetrics'
  );
  const { getPublicBookingContractMode } = await import(
    '../src/lib/booking/publicBookingContractMode'
  );

  const summary = await buildPublicBookingHealthSummary({
    windowHours: 24,
    contractMode: getPublicBookingContractMode(),
  });
  const out = {
    phase: 'booking-phase-8d-post-cutover-monitoring',
    ok: true,
    summary,
  };
  const artifact = path.join(process.cwd(), '_booking-phase8d-health.json');
  fs.writeFileSync(artifact, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify(out, null, 2));
  console.error(`Wrote ${artifact}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

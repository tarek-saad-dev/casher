#!/usr/bin/env npx tsx
/**
 * Booking Phase 7C2 — readiness proof (rate-limit gate, contract mode, error catalog).
 * BOOKING_PHASE_7C2_VERIFIER=enabled npx tsx scripts/verify-booking-phase7c2-readiness.ts
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

const PHASE_NAME = 'booking-phase-7c2-readiness-proof';

const PUBLIC_ROUTE_FILES = [
  'src/app/api/public/branches/route.ts',
  'src/app/api/public/booking/config/route.ts',
  'src/app/api/public/booking/status/route.ts',
  'src/app/api/public/booking/services/route.ts',
  'src/app/api/public/booking/barbers/route.ts',
  'src/app/api/public/booking/barbers/[empId]/calendar/route.ts',
  'src/app/api/public/booking/barbers/[empId]/location/route.ts',
  'src/app/api/public/booking/barbers/[empId]/available-slots/route.ts',
  'src/app/api/public/booking/available-days/route.ts',
  'src/app/api/public/booking/available-slots/route.ts',
  'src/app/api/public/booking/check-slot/route.ts',
  'src/app/api/public/booking/plan/route.ts',
  'src/app/api/public/booking/create/route.ts',
  'src/app/api/public/booking/[code]/route.ts',
  'src/app/api/public/booking/upcoming/route.ts',
  'src/app/api/public/booking/cancel/route.ts',
  'src/app/api/public/booking/[code]/cancel/route.ts',
];

function readRoot(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

async function main() {
  if (process.env.BOOKING_PHASE_7C2_VERIFIER !== 'enabled') {
    console.log('Set BOOKING_PHASE_7C2_VERIFIER=enabled to run.');
    process.exit(2);
  }

  const proofs: Record<string, unknown> = {};
  const root = path.join(__dirname, '..');

  // No legacy getRateLimitKey/checkRateLimit on public routes
  const legacyOffenders: string[] = [];
  const missingGate: string[] = [];
  for (const rel of PUBLIC_ROUTE_FILES) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      legacyOffenders.push(`${rel} (missing)`);
      continue;
    }
    const src = readRoot(rel);
    if (src.includes('getRateLimitKey') || src.includes('checkRateLimit')) {
      legacyOffenders.push(rel);
    }
    if (!src.includes('gatePublicBookingRoute')) {
      missingGate.push(rel);
    }
  }
  proofs.no_legacy_rate_limit_helpers = legacyOffenders.length === 0;
  proofs.legacy_rate_limit_offenders = legacyOffenders;
  proofs.routes_use_gate = missingGate.length === 0;
  proofs.missing_gate_routes = missingGate;

  // Central policy module exists
  const policyPath = 'src/lib/booking/publicBookingRateLimitPolicy.ts';
  proofs.rate_limit_policy_exists = fs.existsSync(path.join(root, policyPath));
  if (proofs.rate_limit_policy_exists) {
    const policySrc = readRoot(policyPath);
    proofs.rate_limit_policy_exports_gate_inputs =
      policySrc.includes('PUBLIC_BOOKING_ROUTE_RATE_FAMILY') &&
      policySrc.includes('resolveRateLimitFromRequest');
  }

  // Contract mode module exists
  const contractPath = 'src/lib/booking/publicBookingContractMode.ts';
  proofs.contract_mode_module_exists = fs.existsSync(path.join(root, contractPath));
  if (proofs.contract_mode_module_exists) {
    const { getPublicBookingContractMode } = await import(
      '../src/lib/booking/publicBookingContractMode'
    );
    proofs.contract_mode_default_compat =
      getPublicBookingContractMode({}) === 'compat';
  }

  // Error catalog codes
  const { PUBLIC_BOOKING_ERROR_CATALOG } = await import(
    '../src/lib/booking/publicBookingErrorCatalog'
  );
  for (const code of [
    'PLAN_TOKEN_REQUIRED',
    'RATE_LIMIT_EXCEEDED',
    'LEGACY_BOOKING_CONTRACT_DISABLED',
  ] as const) {
    proofs[`error_code_${code}`] = PUBLIC_BOOKING_ERROR_CATALOG[code]?.code === code;
  }

  // .env.example documents compat default
  const envExample = readRoot('.env.example');
  proofs.env_example_contract_mode_compat = envExample.includes(
    'PUBLIC_BOOKING_CONTRACT_MODE=compat',
  );

  const required = [
    'no_legacy_rate_limit_helpers',
    'routes_use_gate',
    'rate_limit_policy_exists',
    'rate_limit_policy_exports_gate_inputs',
    'contract_mode_module_exists',
    'contract_mode_default_compat',
    'error_code_PLAN_TOKEN_REQUIRED',
    'error_code_RATE_LIMIT_EXCEEDED',
    'error_code_LEGACY_BOOKING_CONTRACT_DISABLED',
    'env_example_contract_mode_compat',
  ] as const;
  const failed = required.filter((k) => !proofs[k]);
  const passed = failed.length === 0;
  const out = {
    phase: PHASE_NAME,
    passed,
    failed,
    proofs,
  };
  fs.writeFileSync(
    path.join(root, '_booking-phase7c2-readiness-proof.json'),
    JSON.stringify(out, null, 2),
  );
  console.log(JSON.stringify(out, null, 2));
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

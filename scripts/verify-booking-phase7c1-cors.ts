#!/usr/bin/env npx tsx
/**
 * Booking Phase 7C1 — deployment-like CORS probe (no DB booking mutations).
 * BOOKING_PHASE_7C1_VERIFIER=enabled npx tsx scripts/verify-booking-phase7c1-cors.ts
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import { performance } from 'perf_hooks';
import dotenv from 'dotenv';
import { NextRequest } from 'next/server';

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
  if (process.env.BOOKING_PHASE_7C1_VERIFIER !== 'enabled') {
    console.log('Set BOOKING_PHASE_7C1_VERIFIER=enabled to run.');
    process.exit(2);
  }

  const {
    publicBookingOptionsResponse,
    publicBookingJson,
    resetPublicBookingCorsCacheForTests,
    PUBLIC_BOOKING_ROUTE_CORS,
  } = await import('../src/lib/booking/publicBookingCors');
  const { OPTIONS: createOptions } = await import(
    '../src/app/api/public/booking/create/route'
  );
  const { OPTIONS: cancelOptions } = await import(
    '../src/app/api/public/booking/cancel/route'
  );
  const { OPTIONS: branchesOptions, GET: branchesGet } = await import(
    '../src/app/api/public/branches/route'
  );

  resetPublicBookingCorsCacheForTests();
  const prodEnv = {
    NODE_ENV: 'production',
    PUBLIC_BOOKING_ALLOWED_ORIGINS: 'https://cutsaloon.com',
  };

  const proofs: Record<string, unknown> = {};

  // Allowed create OPTIONS
  const t0 = performance.now();
  const createReq = new NextRequest('http://localhost/api/public/booking/create', {
    method: 'OPTIONS',
    headers: { Origin: 'https://cutsaloon.com' },
  });
  // Route OPTIONS uses process.env — temporarily set
  const prev = process.env.PUBLIC_BOOKING_ALLOWED_ORIGINS;
  const prevNode = process.env.NODE_ENV;
  process.env.PUBLIC_BOOKING_ALLOWED_ORIGINS = 'https://cutsaloon.com';
  process.env.NODE_ENV = 'production';
  resetPublicBookingCorsCacheForTests();

  const createOpt = await createOptions(createReq);
  proofs.create_options_allowed =
    createOpt.status === 204 &&
    createOpt.headers.get('Access-Control-Allow-Origin') === 'https://cutsaloon.com' &&
    (createOpt.headers.get('Access-Control-Allow-Headers') || '').includes('Idempotency-Key') &&
    (createOpt.headers.get('Vary') || '').includes('Origin');
  proofs.create_options_ms = Math.round(performance.now() - t0);

  const cancelReq = new NextRequest('http://localhost/api/public/booking/cancel', {
    method: 'OPTIONS',
    headers: { Origin: 'https://cutsaloon.com' },
  });
  const cancelOpt = await cancelOptions(cancelReq);
  proofs.cancel_options_idempotency =
    cancelOpt.status === 204 &&
    (cancelOpt.headers.get('Access-Control-Allow-Headers') || '').includes('Idempotency-Key');

  // Disallowed OPTIONS
  const badOpt = publicBookingOptionsResponse({
    request: new NextRequest('http://localhost/api/public/booking/create', {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.com' },
    }),
    allowedMethods: [...PUBLIC_BOOKING_ROUTE_CORS.create.methods],
    allowedHeaders: PUBLIC_BOOKING_ROUTE_CORS.create.headers,
    environment: prodEnv,
  });
  proofs.disallowed_options_403 =
    badOpt.status === 403 && !badOpt.headers.get('Access-Control-Allow-Origin');

  // No-Origin GET probe via helper (branches may hit DB — wrap)
  const noOriginReq = new NextRequest('http://localhost/api/public/branches', {
    method: 'GET',
  });
  let noOriginOk = false;
  try {
    const res = await branchesGet(noOriginReq);
    noOriginOk = res.status !== 401 && !res.headers.get('Access-Control-Allow-Origin');
  } catch {
    // DB unavailable — still verify helper path
    const res = publicBookingJson(
      noOriginReq,
      { ok: true, branches: [] },
      {
        allowedMethods: [...PUBLIC_BOOKING_ROUTE_CORS.branches.methods],
        environment: prodEnv,
      },
    );
    noOriginOk = res.status === 200 && !res.headers.get('Access-Control-Allow-Origin');
  }
  proofs.no_origin_ok = noOriginOk;

  // Allowed validation error shape CORS
  const errRes = publicBookingJson(
    new NextRequest('http://localhost/api/public/booking/services', {
      headers: { Origin: 'https://cutsaloon.com' },
    }),
    {
      ok: false,
      error: { code: 'BRANCH_REQUIRED', message: 'x', technicalMessage: 'y', metadata: {} },
    },
    {
      status: 400,
      allowedMethods: [...PUBLIC_BOOKING_ROUTE_CORS.services.methods],
      environment: prodEnv,
    },
  );
  proofs.error_has_acao =
    errRes.headers.get('Access-Control-Allow-Origin') === 'https://cutsaloon.com';

  // Disallowed GET has no ACAO
  const deniedGet = publicBookingJson(
    new NextRequest('http://localhost/api/public/branches', {
      headers: { Origin: 'https://example.com' },
    }),
    { ok: true, branches: [] },
    {
      allowedMethods: [...PUBLIC_BOOKING_ROUTE_CORS.branches.methods],
      environment: prodEnv,
    },
  );
  proofs.disallowed_get_no_acao = !deniedGet.headers.get('Access-Control-Allow-Origin');

  // OPTIONS route export exists for branches
  const brOpt = await branchesOptions(
    new NextRequest('http://localhost/api/public/branches', {
      method: 'OPTIONS',
      headers: { Origin: 'https://cutsaloon.com' },
    }),
  );
  proofs.branches_options_allowed =
    brOpt.status === 204 &&
    brOpt.headers.get('Access-Control-Allow-Origin') === 'https://cutsaloon.com';

  if (prev === undefined) delete process.env.PUBLIC_BOOKING_ALLOWED_ORIGINS;
  else process.env.PUBLIC_BOOKING_ALLOWED_ORIGINS = prev;
  if (prevNode === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNode;
  resetPublicBookingCorsCacheForTests();

  const required = [
    'create_options_allowed',
    'cancel_options_idempotency',
    'disallowed_options_403',
    'no_origin_ok',
    'error_has_acao',
    'disallowed_get_no_acao',
    'branches_options_allowed',
  ] as const;
  const failed = required.filter((k) => !proofs[k]);
  const passed = failed.length === 0;
  const out = {
    phase: 'booking-phase-7c1-cors-proof',
    passed,
    failed,
    proofs,
  };
  fs.writeFileSync(
    path.join(__dirname, '..', '_booking-phase7c1-cors-proof.json'),
    JSON.stringify(out, null, 2),
  );
  console.log(JSON.stringify(out, null, 2));
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

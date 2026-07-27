/**
 * Read-only live HTTP probe for Booking Phase 2 services catalog.
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });

const BASE = process.env.PHASE2_PROBE_BASE || 'http://127.0.0.1:3000';

async function probe(url: string) {
  const t0 = Date.now();
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  const ms = Date.now() - t0;
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return { status: res.status, ms, bytes: Buffer.byteLength(text, 'utf8'), body, headers: Object.fromEntries(res.headers) };
}

async function main() {
  const gleemUrl = `${BASE}/api/public/booking/services?branchCode=GLEEM`;
  const ccUrl = `${BASE}/api/public/booking/services?branchCode=CAMP_CAESAR`;
  const missingUrl = `${BASE}/api/public/booking/services`;
  const optionsRes = await fetch(gleemUrl, { method: 'OPTIONS' });

  const cold = await probe(gleemUrl);
  const warm = await probe(gleemUrl);
  const cc = await probe(ccUrl);
  const missing = await probe(missingUrl);

  const gleemBody = cold.body as {
    ok?: boolean;
    categories?: Array<{ services: Array<{ serviceId: number; price: number; durationMinutes: number }> }>;
    services?: Array<{ serviceId: number; price: number; durationMinutes: number; name?: string }>;
    meta?: { serviceCount: number; categoryCount: number };
    error?: { code?: string };
  };

  const services = gleemBody.services ?? [];
  const ids = services.map((s) => s.serviceId);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  const invalidDur = services.filter((s) => !Number.isInteger(s.durationMinutes) || s.durationMinutes <= 0).length;
  const invalidPrice = services.filter((s) => typeof s.price !== 'number' || !Number.isFinite(s.price) || s.price < 0).length;
  const productLeak = services.filter((s) => /منتج|product/i.test(String(s.name ?? ''))).length;

  const out = {
    base: BASE,
    options: {
      status: optionsRes.status,
      acao: optionsRes.headers.get('access-control-allow-origin'),
      acam: optionsRes.headers.get('access-control-allow-methods'),
      acah: optionsRes.headers.get('access-control-allow-headers'),
    },
    gleem: {
      status: cold.status,
      coldMs: cold.ms,
      warmMs: warm.ms,
      bytes: cold.bytes,
      categoryCount: gleemBody.meta?.categoryCount ?? gleemBody.categories?.length ?? null,
      serviceCount: gleemBody.meta?.serviceCount ?? services.length,
      duplicateIds: dupes,
      invalidDurationCount: invalidDur,
      invalidPriceCount: invalidPrice,
      productNameHeuristicLeak: productLeak,
      cors: cold.headers['access-control-allow-origin'] ?? null,
    },
    campCaesar: {
      status: cc.status,
      body: cc.body,
      cors: cc.headers['access-control-allow-origin'] ?? null,
    },
    missingBranch: {
      status: missing.status,
      body: missing.body,
    },
  };

  const outPath = path.join(__dirname, '_booking-phase2-live-http-probe.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify(out, null, 2));
  console.log('wrote', outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

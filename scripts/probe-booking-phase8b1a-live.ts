#!/usr/bin/env npx tsx
/**
 * Phase 8B1A — live public booking operational probes (read-only by default).
 * BOOKING_PHASE_8B1A_PROBE=enabled npx tsx scripts/probe-booking-phase8b1a-live.ts
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const BASE = process.env.PUBLIC_BOOKING_PROBE_BASE || 'https://casher-five.vercel.app';
const ORIGIN = 'https://cutsaloon.com';

type ProbeResult = {
  label: string;
  url: string;
  attempt: number;
  timestamp: string;
  status: number;
  errorCode: string | null;
  requestId: string | null;
  contractVersion: string | null;
  rateLimitRemaining: string | null;
  rateLimitLimit: string | null;
  exposeHeaders: string | null;
  bodySummary: Record<string, unknown>;
  rawSnippet: string;
};

async function probe(
  label: string,
  urlPath: string,
  attempt: number,
  init?: RequestInit,
): Promise<ProbeResult> {
  const url = `${BASE}${urlPath}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Origin: ORIGIN,
      Accept: 'application/json',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const err = b.error as { code?: string } | undefined;
  const services = Array.isArray(b.services) ? b.services : null;
  const barbers = Array.isArray(b.barbers) ? b.barbers : null;
  const branches = Array.isArray(b.branches) ? b.branches : null;
  const days = Array.isArray(b.days) ? b.days : null;
  const slots = Array.isArray(b.slots) ? b.slots : null;

  return {
    label,
    url,
    attempt,
    timestamp: new Date().toISOString(),
    status: res.status,
    errorCode: err?.code ?? (typeof b.code === 'string' ? b.code : null),
    requestId: res.headers.get('X-Request-Id'),
    contractVersion: res.headers.get('X-Booking-Contract-Version'),
    rateLimitRemaining: res.headers.get('X-RateLimit-Remaining'),
    rateLimitLimit: res.headers.get('X-RateLimit-Limit'),
    exposeHeaders: res.headers.get('Access-Control-Expose-Headers'),
    bodySummary: {
      ok: b.ok ?? null,
      serviceCount: services ? services.length : null,
      barberCount: barbers ? barbers.length : null,
      branchCount: branches ? branches.length : null,
      branchCodes: branches
        ? (branches as Array<{ branchCode?: string }>).map((x) => x.branchCode)
        : null,
      dayCount: days ? days.length : null,
      dayStatuses: days
        ? [
            ...new Set(
              (days as Array<{ status?: string }>).map((d) => d.status ?? '?'),
            ),
          ]
        : null,
      availableDayCount: days
        ? (days as Array<{ isAvailable?: boolean }>).filter((d) => d.isAvailable).length
        : null,
      slotCount: slots ? slots.length : null,
      bookingEnabled: (b as { bookingEnabled?: unknown }).bookingEnabled ?? null,
      publicBookingEnabled:
        (b as { publicBookingEnabled?: unknown }).publicBookingEnabled ?? null,
      status: (b as { status?: unknown }).status ?? null,
      firstServiceIds: services
        ? (services as Array<{ serviceId?: number }>)
            .slice(0, 5)
            .map((s) => s.serviceId)
        : null,
      firstBarberIds: barbers
        ? (barbers as Array<{ empId?: number }>).slice(0, 5).map((x) => x.empId)
        : null,
    },
    rawSnippet: text.slice(0, 400),
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (process.env.BOOKING_PHASE_8B1A_PROBE !== 'enabled') {
    console.log('Set BOOKING_PHASE_8B1A_PROBE=enabled to run.');
    process.exit(2);
  }

  const results: ProbeResult[] = [];
  const reads = [
    ['branches', '/api/public/branches'],
    ['config', '/api/public/booking/config?branchCode=GLEEM'],
    ['status', '/api/public/booking/status?branchCode=GLEEM'],
    ['services', '/api/public/booking/services?branchCode=GLEEM'],
    ['barbers', '/api/public/booking/barbers?branchCode=GLEEM'],
  ] as const;

  for (let attempt = 1; attempt <= 3; attempt++) {
    for (const [label, pathUrl] of reads) {
      results.push(await probe(label, pathUrl, attempt));
      await sleep(800);
    }
    if (attempt < 3) await sleep(1500);
  }

  // Capture one services body fully for catalog proof (IDs/prices only)
  const servicesRes = await fetch(`${BASE}/api/public/booking/services?branchCode=GLEEM`, {
    headers: { Origin: ORIGIN },
    cache: 'no-store',
  });
  const servicesJson = (await servicesRes.json()) as {
    ok?: boolean;
    services?: Array<{
      serviceId: number;
      nameAr?: string;
      price?: number;
      durationMinutes?: number;
      category?: string;
    }>;
  };

  // available-days with first service if any
  let daysProbe: ProbeResult | null = null;
  let daysBody: unknown = null;
  const firstServiceId = servicesJson.services?.[0]?.serviceId;
  if (firstServiceId) {
    daysProbe = await probe(
      'available-days',
      `/api/public/booking/available-days?branchCode=GLEEM&serviceIds=${firstServiceId}`,
      1,
    );
    const daysRes = await fetch(
      `${BASE}/api/public/booking/available-days?branchCode=GLEEM&serviceIds=${firstServiceId}`,
      { headers: { Origin: ORIGIN }, cache: 'no-store' },
    );
    daysBody = await daysRes.json();
  }

  // Camp Caesar privacy
  const camp = await probe(
    'camp-config',
    '/api/public/booking/config?branchCode=CAMP_CAESAR',
    1,
  );

  const out = {
    phase: 'booking-phase-8b1a-live-probe',
    base: BASE,
    origin: ORIGIN,
    probedAt: new Date().toISOString(),
    results,
    servicesCatalog: {
      status: servicesRes.status,
      count: servicesJson.services?.length ?? 0,
      services: (servicesJson.services ?? []).map((s) => ({
        serviceId: s.serviceId,
        nameAr: s.nameAr,
        price: s.price,
        durationMinutes: s.durationMinutes,
        category: s.category,
      })),
    },
    availableDays: {
      probe: daysProbe,
      firstServiceId: firstServiceId ?? null,
      body: daysBody,
    },
    camp,
  };

  const outPath = path.join(__dirname, '..', '_booking-phase8b1a-live-probe.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ wrote: outPath, resultCount: results.length, serviceCount: out.servicesCatalog.count, campStatus: camp.status, campCode: camp.errorCode }, null, 2));

  // Print compact matrix
  for (const r of results) {
    console.log(
      `${r.label}#${r.attempt} status=${r.status} code=${r.errorCode ?? '-'} svc=${r.bodySummary.serviceCount} bar=${r.bodySummary.barberCount} rl=${r.rateLimitRemaining} id=${r.requestId}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env npx tsx
/**
 * Read-only HTTP A/B benchmark: same localhost:5500 endpoints against whatever DB
 * .env.local currently points at (VPS or Azure).
 *
 * - No invoice/booking/client/attendance/cash writes
 * - Login only sets a signed cookie (no session table write)
 * - Never prints DB passwords / secrets
 *
 * Usage:
 *   npx tsx scripts/benchmark-db-ab-http.ts --label VPS --out tmp/bench-vps.json
 *   npx tsx scripts/benchmark-db-ab-http.ts --label AZURE --out tmp/bench-azure.json
 *
 * Optional:
 *   BENCH_LOGIN / BENCH_PASSWORD  — skip DB credential lookup
 *   BENCH_BASE_URL                — default http://localhost:5500
 *   BENCH_WARM=2 BENCH_ITERS=12
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

type Stats = {
  n: number;
  min: number;
  avg: number;
  p50: number;
  p95: number;
  max: number;
};

type Sample = {
  httpMs: number;
  status: number;
  serverTiming?: Record<string, number>;
  bytes: number;
};

type EndpointResult = {
  name: string;
  method: 'GET' | 'POST';
  url: string;
  warmDiscarded: number;
  samples: Sample[];
  http: Stats;
  serverTimingAvg?: Record<string, number>;
  okRate: number;
};

type BenchReport = {
  label: string;
  startedAt: string;
  finishedAt: string;
  baseUrl: string;
  dbExpected: {
    server: string;
    database: string;
    user: string;
    encrypt: string;
    trustServerCertificate: string;
  };
  dbProbe?: {
    dbName: string;
    serverName: string;
    probeMs: number;
  };
  page?: {
    path: string;
    warmHttpMs: number[];
    stats: Stats;
  };
  endpoints: EndpointResult[];
  notes: string[];
};

function argValue(flag: string, fallback = ''): string {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return String(process.argv[i + 1]);
  return fallback;
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx]!;
}

function statsOf(values: number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    min: sorted[0] ?? 0,
    avg: sorted.length ? Math.round(sum / sorted.length) : 0,
    p50: pct(sorted, 50),
    p95: pct(sorted, 95),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function parseServerTiming(header: string | null): Record<string, number> | undefined {
  if (!header) return undefined;
  const out: Record<string, number> = {};
  for (const part of header.split(',')) {
    const seg = part.trim();
    if (!seg) continue;
    const name = seg.split(';')[0]?.trim();
    const dur = /(?:^|;)\s*dur=([0-9.]+)/i.exec(seg);
    if (name && dur) out[name] = Math.round(Number(dur[1]));
  }
  return Object.keys(out).length ? out : undefined;
}

function maskServer(server: string): string {
  const s = String(server || '').trim();
  if (!s) return '(empty)';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) {
    const parts = s.split('.');
    return `${parts[0]}.***.***.${parts[3]}`;
  }
  if (s.includes('.')) {
    const [host, ...rest] = s.split('.');
    return `${host.slice(0, 3)}…${host.slice(-2)}.${rest.join('.')}`;
  }
  return `${s.slice(0, 3)}…`;
}

function todayCairoLike(): string {
  // Enough for query params; app uses Cairo business date internally when omitted.
  const d = new Date();
  const cairo = new Date(d.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
  const y = cairo.getFullYear();
  const m = String(cairo.getMonth() + 1).padStart(2, '0');
  const day = String(cairo.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function probeDbIdentity(): Promise<BenchReport['dbProbe']> {
  const server = process.env.DB_SERVER || '';
  const database = process.env.DB_DATABASE || process.env.DB_NAME || '';
  const user = process.env.DB_USER || '';
  const password = (process.env.DB_PASSWORD || '').replace(/^"|"$/g, '');
  if (!server || !database || !user) {
    throw new Error('DB_SERVER/DB_DATABASE/DB_USER missing in env');
  }
  if (/YOUR_OLD|REPLACE_WITH|CHANGE_ME/i.test(password)) {
    throw new Error('DB_PASSWORD looks like a placeholder — refuse to connect');
  }

  const t0 = Date.now();
  const pool = await new sql.ConnectionPool({
    server,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database,
    user,
    password,
    options: {
      encrypt: process.env.DB_ENCRYPT !== 'false',
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
      enableArithAbort: true,
    },
    connectionTimeout: 30000,
    requestTimeout: 30000,
  }).connect();

  try {
    const r = await pool.request().query(`
      SELECT DB_NAME() AS DbName, @@SERVERNAME AS ServerName
    `);
    return {
      dbName: String(r.recordset[0]?.DbName ?? ''),
      serverName: String(r.recordset[0]?.ServerName ?? ''),
      probeMs: Date.now() - t0,
    };
  } finally {
    await pool.close();
  }
}

async function resolveLoginFromDb(): Promise<{ loginName: string; password: string }> {
  const envLogin = process.env.BENCH_LOGIN?.trim();
  const envPass = process.env.BENCH_PASSWORD?.trim();
  if (envLogin && envPass) return { loginName: envLogin, password: envPass };

  const server = process.env.DB_SERVER || '';
  const database = process.env.DB_DATABASE || process.env.DB_NAME || '';
  const user = process.env.DB_USER || '';
  const password = (process.env.DB_PASSWORD || '').replace(/^"|"$/g, '');

  const pool = await new sql.ConnectionPool({
    server,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    database,
    user,
    password,
    options: {
      encrypt: process.env.DB_ENCRYPT !== 'false',
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
      enableArithAbort: true,
    },
    connectionTimeout: 30000,
    requestTimeout: 30000,
  }).connect();

  try {
    // Prefer known admin loginName; never print Password.
    const preferred = ['tarek', 'Tarek', 'admin', 'Admin'];
    for (const name of preferred) {
      const r = await pool
        .request()
        .input('loginName', name)
        .query(`
          SELECT TOP 1 loginName, Password
          FROM dbo.TblUser
          WHERE loginName = @loginName AND ISNULL(isDeleted, 0) = 0
        `);
      const row = r.recordset[0];
      if (row?.loginName && row?.Password) {
        return {
          loginName: String(row.loginName),
          password: String(row.Password),
        };
      }
    }
    const anyAdmin = await pool.request().query(`
      SELECT TOP 1 loginName, Password
      FROM dbo.TblUser
      WHERE ISNULL(isDeleted, 0) = 0
        AND (
          LOWER(ISNULL(UserLevel,'')) IN ('admin','super_admin','owner')
          OR LOWER(ISNULL(loginName,'')) LIKE '%admin%'
        )
      ORDER BY UserID
    `);
    const row = anyAdmin.recordset[0];
    if (!row?.loginName || !row?.Password) {
      throw new Error('No usable login found in TblUser (set BENCH_LOGIN/BENCH_PASSWORD)');
    }
    return {
      loginName: String(row.loginName),
      password: String(row.Password),
    };
  } finally {
    await pool.close();
  }
}

function cookieFromSetCookie(setCookie: string[] | string | null): string {
  const list = Array.isArray(setCookie)
    ? setCookie
    : setCookie
      ? [setCookie]
      : [];
  const parts: string[] = [];
  for (const c of list) {
    const first = String(c).split(';')[0]?.trim();
    if (first) parts.push(first);
  }
  return parts.join('; ');
}

async function login(baseUrl: string): Promise<string> {
  const creds = await resolveLoginFromDb();
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      loginName: creds.loginName,
      password: creds.password,
    }),
  });
  // Wipe local copies
  creds.password = '';
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`login failed status=${res.status} body=${text.slice(0, 200)}`);
  }
  const raw =
    typeof (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie ===
    'function'
      ? (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
      : res.headers.get('set-cookie');
  const cookie = cookieFromSetCookie(raw);
  if (!cookie.includes('pos_session=')) {
    throw new Error('login succeeded but pos_session cookie missing');
  }
  console.log(`[bench] logged in as ${creds.loginName} (password redacted)`);
  return cookie;
}

async function measureOnce(
  baseUrl: string,
  cookie: string,
  method: 'GET' | 'POST',
  pathAndQuery: string,
  body?: unknown,
): Promise<Sample> {
  const t0 = Date.now();
  const res = await fetch(`${baseUrl}${pathAndQuery}`, {
    method,
    headers: {
      cookie,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const httpMs = Date.now() - t0;
  return {
    httpMs,
    status: res.status,
    serverTiming: parseServerTiming(res.headers.get('server-timing')),
    bytes: buf.length,
  };
}

async function benchEndpoint(
  baseUrl: string,
  cookie: string,
  name: string,
  method: 'GET' | 'POST',
  pathAndQuery: string,
  warm: number,
  iters: number,
  body?: unknown,
): Promise<EndpointResult> {
  // Warm / compile discard
  for (let i = 0; i < warm; i++) {
    await measureOnce(baseUrl, cookie, method, pathAndQuery, body);
  }

  const samples: Sample[] = [];
  for (let i = 0; i < iters; i++) {
    samples.push(await measureOnce(baseUrl, cookie, method, pathAndQuery, body));
  }

  const timingKeys = new Set<string>();
  for (const s of samples) {
    if (s.serverTiming) Object.keys(s.serverTiming).forEach((k) => timingKeys.add(k));
  }
  let serverTimingAvg: Record<string, number> | undefined;
  if (timingKeys.size) {
    serverTimingAvg = {};
    for (const k of timingKeys) {
      const vals = samples
        .map((s) => s.serverTiming?.[k])
        .filter((v): v is number => typeof v === 'number');
      serverTimingAvg[k] = vals.length
        ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
        : 0;
    }
  }

  const ok = samples.filter((s) => s.status >= 200 && s.status < 400).length;
  return {
    name,
    method,
    url: pathAndQuery,
    warmDiscarded: warm,
    samples,
    http: statsOf(samples.map((s) => s.httpMs)),
    serverTimingAvg,
    okRate: samples.length ? ok / samples.length : 0,
  };
}

async function main() {
  const label = argValue('--label', 'RUN');
  const outPath = argValue('--out', path.join('tmp', `bench-${label.toLowerCase()}.json`));
  const baseUrl = (process.env.BENCH_BASE_URL || 'http://localhost:5500').replace(/\/$/, '');
  const warm = Math.max(1, parseInt(process.env.BENCH_WARM || '2', 10));
  const iters = Math.max(5, parseInt(process.env.BENCH_ITERS || '12', 10));
  const date = todayCairoLike();

  const notes: string[] = [
    'Warm requests discarded from stats (compile/cold excluded).',
    'No production-like writes (invoices/bookings/clients/attendance/cash).',
    'Login uses signed cookie only.',
    'Secrets never written to this report.',
  ];

  console.log(`[bench] label=${label} base=${baseUrl} warm=${warm} iters=${iters}`);
  console.log(
    `[bench] env DB_SERVER=${maskServer(process.env.DB_SERVER || '')} DB_DATABASE=${process.env.DB_DATABASE || ''}`,
  );

  const dbExpected = {
    server: process.env.DB_SERVER || '',
    database: process.env.DB_DATABASE || process.env.DB_NAME || '',
    user: process.env.DB_USER || '',
    encrypt: process.env.DB_ENCRYPT || '',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE || '',
  };

  let dbProbe: BenchReport['dbProbe'];
  try {
    dbProbe = await probeDbIdentity();
    console.log(
      `[bench] direct DB probe ok db=${dbProbe.dbName} serverName=${dbProbe.serverName} ms=${dbProbe.probeMs}`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[bench] direct DB probe failed: ${msg}`);
    notes.push(`direct DB probe failed: ${msg}`);
  }

  // Confirm app is up
  const health = await fetch(`${baseUrl}/api/auth/login`);
  if (!health.ok) throw new Error(`app not reachable at ${baseUrl}`);

  const cookie = await login(baseUrl);

  // Session sanity
  const sess = await measureOnce(baseUrl, cookie, 'GET', '/api/auth/session');
  if (sess.status !== 200) throw new Error(`session check status=${sess.status}`);

  const endpointsSpec: Array<{
    name: string;
    method: 'GET' | 'POST';
    path: string;
    body?: unknown;
  }> = [
    { name: 'auth.session', method: 'GET', path: '/api/auth/session' },
    { name: 'permissions.my-access', method: 'GET', path: '/api/permissions/my-access' },
    { name: 'auth.branches', method: 'GET', path: '/api/auth/branches' },
    { name: 'branches.available', method: 'GET', path: '/api/branches/available' },
    { name: 'barbers', method: 'GET', path: '/api/barbers' },
    { name: 'barbers.scope-barber', method: 'GET', path: '/api/barbers?scope=barber' },
    { name: 'services', method: 'GET', path: '/api/services' },
    { name: 'payment-methods', method: 'GET', path: '/api/payment-methods' },
    {
      name: 'sales.recent-invoices',
      method: 'GET',
      path: '/api/sales/recent-invoices?limit=20',
    },
    {
      name: 'pos.team-attendance',
      method: 'GET',
      path: `/api/pos/team-attendance?date=${date}`,
    },
    { name: 'day.rollover-check', method: 'GET', path: '/api/day/rollover-check' },
    {
      name: 'ops.flow-board',
      method: 'GET',
      path: `/api/operations/flow-board?date=${date}&branchId=active&presence=present`,
    },
    {
      name: 'ops.due-announcements',
      method: 'GET',
      path: `/api/operations/queue/due-announcements?date=${date}`,
    },
    {
      name: 'ops.schedule-control',
      method: 'GET',
      path: `/api/operations/schedule-control?date=${date}`,
    },
    {
      name: 'ops.employees.day-state',
      method: 'GET',
      path: `/api/operations/employees/day-state?date=${date}`,
    },
    { name: 'ops.status', method: 'GET', path: '/api/operations/status' },
    { name: 'ops.overview', method: 'GET', path: '/api/operations/overview' },
    { name: 'admin.booking-settings', method: 'GET', path: '/api/admin/booking-settings' },
    {
      name: 'public.booking.v2.bootstrap',
      method: 'GET',
      path: '/api/public/booking/v2/bootstrap',
    },
    { name: 'health.db', method: 'GET', path: '/api/health/db' },
  ];

  const startedAt = new Date().toISOString();
  const endpoints: EndpointResult[] = [];

  for (const spec of endpointsSpec) {
    process.stdout.write(`[bench] ${spec.name} ... `);
    const result = await benchEndpoint(
      baseUrl,
      cookie,
      spec.name,
      spec.method,
      spec.path,
      warm,
      iters,
      spec.body,
    );
    endpoints.push(result);
    const bad = result.samples.filter((s) => s.status >= 400);
    console.log(
      `p50=${result.http.p50}ms p95=${result.http.p95}ms ok=${(result.okRate * 100).toFixed(0)}%` +
        (bad.length ? ` statuses=${[...new Set(bad.map((s) => s.status))].join(',')}` : ''),
    );
  }

  // Page timing after warm
  const pageWarm: number[] = [];
  for (let i = 0; i < warm; i++) {
    await measureOnce(baseUrl, cookie, 'GET', '/operations');
  }
  const pageSamples: number[] = [];
  for (let i = 0; i < Math.max(5, Math.floor(iters / 2)); i++) {
    const s = await measureOnce(baseUrl, cookie, 'GET', '/operations');
    pageSamples.push(s.httpMs);
    pageWarm.push(s.httpMs);
  }
  console.log(
    `[bench] /operations page p50=${statsOf(pageSamples).p50}ms p95=${statsOf(pageSamples).p95}ms`,
  );

  const report: BenchReport = {
    label,
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl,
    dbExpected,
    dbProbe,
    page: {
      path: '/operations',
      warmHttpMs: pageSamples,
      stats: statsOf(pageSamples),
    },
    endpoints,
    notes,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // Scrub any accidental password fields
  const json = JSON.stringify(
    report,
    (key, value) => {
      if (/password|secret|token/i.test(key)) return '[redacted]';
      return value;
    },
    2,
  );
  fs.writeFileSync(outPath, json, 'utf8');
  console.log(`[bench] wrote ${outPath}`);

  // Summary table
  console.log('\nEndpoint | p50 | p95 | max | ok%');
  for (const e of endpoints) {
    console.log(
      `${e.name} | ${e.http.p50} | ${e.http.p95} | ${e.http.max} | ${(e.okRate * 100).toFixed(0)}`,
    );
  }
}

main().catch((err) => {
  console.error('[bench] FATAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});

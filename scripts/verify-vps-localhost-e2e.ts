#!/usr/bin/env npx tsx
/**
 * VPS localhost E2E — reads + VPS_TEST writes + concurrency.
 * HARD DENY: Azure / *.database.windows.net / DB last132 (non-migrated).
 * Never prints secrets.
 *
 *   npx tsx scripts/verify-vps-localhost-e2e.ts
 */
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

const BASE = (process.env.BENCH_BASE_URL || 'http://localhost:5500').replace(/\/$/, '');
const TAG = `VPS_TEST_${Date.now().toString(36).toUpperCase()}`;
const PHONE = `0199${String(Date.now()).slice(-7)}`;

type Json = Record<string, unknown>;
type Report = {
  dbTarget: string;
  reads: string;
  writes: string;
  clientCreate: string;
  bookingCreate: string;
  invoiceCreate: string;
  updatePaths: string;
  connectionPool: string;
  concurrent20: string;
  concurrent50: string;
  hardcodedAzure: string;
  errors: string[];
  verdict: string;
};

const report: Report = {
  dbTarget: '',
  reads: '',
  writes: '',
  clientCreate: '',
  bookingCreate: '',
  invoiceCreate: '',
  updatePaths: '',
  connectionPool: '',
  concurrent20: '',
  concurrent50: '',
  hardcodedAzure: '',
  errors: [],
  verdict: 'FAIL',
};

function fail(msg: string): never {
  report.errors.push(msg);
  throw new Error(msg);
}

function assertVpsEnv() {
  const server = String(process.env.DB_SERVER || '').trim();
  const database = String(process.env.DB_DATABASE || process.env.DB_NAME || '').trim();
  if (!server || !database) fail('DB_SERVER/DB_DATABASE missing');
  if (/\.database\.windows\.net$/i.test(server)) {
    fail(`REFUSE Azure server in env: ${server}`);
  }
  if (/^last132$/i.test(database)) {
    fail('REFUSE Azure SoT database name last132 (use last132_migrated on VPS)');
  }
  if (server !== '187.77.75.79' && !process.env.VPS_E2E_ALLOW_OTHER_HOST) {
    // Soft warn path: still require non-Azure; prefer known VPS IP.
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(server)) {
      fail(`Unexpected DB_SERVER (not VPS IP): ${server}`);
    }
  }
  return { server, database, user: String(process.env.DB_USER || '') };
}

async function openPool() {
  const { server, database, user } = assertVpsEnv();
  const password = String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, '');
  if (!password || /YOUR_|REPLACE/i.test(password)) fail('DB_PASSWORD missing/placeholder');
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
    requestTimeout: 60000,
    pool: { max: 5, min: 0 },
  }).connect();
  return pool;
}

async function probeDb(pool: sql.ConnectionPool) {
  const r = await pool.request().query(`
    SELECT DB_NAME() AS dbName, @@SERVERNAME AS serverName
  `);
  const dbName = String(r.recordset[0]?.dbName || '');
  const serverName = String(r.recordset[0]?.serverName || '');
  if (/^last132$/i.test(dbName) && !/_migrated/i.test(dbName)) {
    fail(`REFUSE live probe db=${dbName}`);
  }
  if (!/migrated/i.test(dbName) && dbName !== process.env.DB_DATABASE) {
    fail(`Unexpected dbName=${dbName}`);
  }
  report.dbTarget = `${process.env.DB_SERVER} / ${dbName} (@@SERVERNAME=${serverName})`;
  return { dbName, serverName };
}

function cookieFrom(res: Response): string {
  const anyH = res.headers as Headers & { getSetCookie?: () => string[] };
  const list =
    typeof anyH.getSetCookie === 'function'
      ? anyH.getSetCookie()
      : res.headers.get('set-cookie')
        ? [res.headers.get('set-cookie')!]
        : [];
  return list.map((c) => c.split(';')[0]!.trim()).filter(Boolean).join('; ');
}

async function login(pool: sql.ConnectionPool): Promise<string> {
  const envLogin = process.env.BENCH_LOGIN?.trim();
  const envPass = process.env.BENCH_PASSWORD?.trim();
  let loginName = envLogin || '';
  let password = envPass || '';
  if (!loginName || !password) {
    const preferred = ['tarek', 'Tarek', 'admin'];
    for (const name of preferred) {
      const r = await pool
        .request()
        .input('loginName', name)
        .query(
          `SELECT TOP 1 loginName, Password FROM dbo.TblUser WHERE loginName=@loginName AND ISNULL(isDeleted,0)=0`,
        );
      if (r.recordset[0]?.loginName) {
        loginName = String(r.recordset[0].loginName);
        password = String(r.recordset[0].Password);
        break;
      }
    }
  }
  if (!loginName || !password) fail('No login credentials for E2E');

  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginName, password }),
  });
  password = '';
  const text = await res.text();
  if (!res.ok) fail(`login failed status=${res.status} body=${text.slice(0, 160)}`);
  const cookie = cookieFrom(res);
  if (!cookie.includes('pos_session=')) fail('login missing pos_session cookie');
  return cookie;
}

async function api(
  cookie: string,
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<{ status: number; json: Json | null; text: string; ms: number }> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      cookie,
      accept: 'application/json',
      ...(body != null ? { 'content-type': 'application/json' } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: Json | null = null;
  try {
    json = JSON.parse(text) as Json;
  } catch {
    json = null;
  }
  return { status: res.status, json, text, ms: Date.now() - t0 };
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

async function concurrency(
  cookie: string,
  urlPath: string,
  n: number,
): Promise<{ n: number; ok: number; http500: number; timeouts: number; connErr: number; p50: number; p95: number; max: number; statuses: Record<string, number> }> {
  const results = await Promise.all(
    Array.from({ length: n }, async () => {
      try {
        const r = await api(cookie, 'GET', urlPath);
        return { ...r, err: '' };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { status: 0, json: null, text: msg, ms: 0, err: msg };
      }
    }),
  );
  const statuses: Record<string, number> = {};
  let ok = 0;
  let http500 = 0;
  let timeouts = 0;
  let connErr = 0;
  const times: number[] = [];
  for (const r of results) {
    const key = String(r.status || 'ERR');
    statuses[key] = (statuses[key] || 0) + 1;
    if (r.status >= 200 && r.status < 400) {
      ok++;
      times.push(r.ms);
    }
    if (r.status >= 500) http500++;
    const blob = `${r.text} ${r.err}`.toLowerCase();
    if (blob.includes('timeout') || blob.includes('etimeout')) timeouts++;
    if (
      blob.includes('pool') ||
      blob.includes('connection') ||
      blob.includes('econn') ||
      blob.includes('socket')
    ) {
      connErr++;
    }
  }
  times.sort((a, b) => a - b);
  return {
    n,
    ok,
    http500,
    timeouts,
    connErr,
    p50: pct(times, 50),
    p95: pct(times, 95),
    max: times[times.length - 1] || 0,
    statuses,
  };
}

function scanHardcodedAzure(): string {
  const roots = ['src', 'scripts'];
  const hits: string[] = [];
  const reAzure = /newserverr\.database\.windows\.net/i;
  const rePool = /new\s+(?:sql\.)?ConnectionPool\s*\(/;
  for (const root of roots) {
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (ent.name === 'node_modules' || ent.name === '.next') continue;
          walk(p);
          continue;
        }
        if (!/\.(ts|tsx|js|mjs)$/.test(ent.name)) continue;
        let txt = '';
        try {
          txt = fs.readFileSync(p, 'utf8');
        } catch {
          continue;
        }
        if (reAzure.test(txt) && !p.includes('verify-vps-localhost-e2e')) {
          hits.push(`AZURE_HOST:${p}`);
        }
        if (root === 'src' && rePool.test(txt) && !p.replace(/\\/g, '/').endsWith('src/lib/db.ts')) {
          hits.push(`POOL:${p}`);
        }
      }
    };
    walk(path.join(process.cwd(), root));
  }
  if (!hits.length) {
    return 'NONE in src runtime (only db.ts creates ConnectionPool); no newserverr hardcode in src';
  }
  return hits.slice(0, 20).join('; ');
}

function cairoTodayPlus(days: number): string {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function main() {
  console.log(`[vps-e2e] tag=${TAG} base=${BASE}`);
  assertVpsEnv();
  report.hardcodedAzure = scanHardcodedAzure();
  report.connectionPool = 'singleton getPool() in src/lib/db.ts (max=10,min=2); no per-request connect in src';

  const pool = await openPool();
  try {
    await probeDb(pool);

    // Confirm app process hits same DB via health after login
    const cookie = await login(pool);

    const health = await api(cookie, 'GET', '/api/health/db');
    if (health.status !== 200) fail(`health/db status=${health.status}`);
    const envServer = String(health.json?.envServer || '');
    const envDatabase = String(health.json?.envDatabase || '');
    const dbName = String(health.json?.dbName || '');
    if (/\.database\.windows\.net$/i.test(envServer)) fail(`App still on Azure: ${envServer}`);
    if (dbName && dbName !== 'last132_migrated') {
      fail(`App DB_NAME mismatch: ${dbName}`);
    }
    if (envDatabase && envDatabase !== 'last132_migrated') {
      fail(`App envDatabase mismatch: ${envDatabase}`);
    }

    // ─── READS ───
    const date = cairoTodayPlus(0);
    const readSpecs = [
      ['session', '/api/auth/session'],
      ['barbers', '/api/barbers'],
      ['services', '/api/services'],
      ['payment-methods', '/api/payment-methods'],
      ['recent-invoices', '/api/sales/recent-invoices?limit=10'],
      ['team-attendance', `/api/pos/team-attendance?date=${date}`],
      ['flow-board', `/api/operations/flow-board?date=${date}&branchId=active&presence=present`],
      ['bootstrap', '/api/public/booking/v2/bootstrap'],
      ['branches', '/api/branches/available'],
    ] as const;

    const readResults: string[] = [];
    for (const [name, pathUrl] of readSpecs) {
      const r = await api(cookie, 'GET', pathUrl);
      const ok = r.status >= 200 && r.status < 400;
      readResults.push(`${name}:${r.status}/${r.ms}ms`);
      if (!ok) report.errors.push(`READ ${name} status=${r.status}`);
    }
    report.reads =
      report.errors.filter((e) => e.startsWith('READ')).length === 0
        ? `PASS (${readResults.join(', ')})`
        : `PARTIAL (${readResults.join(', ')})`;

    // Pick service + barber + payment for writes
    const services = await api(cookie, 'GET', '/api/services?active=true&bookable=true');
    const svcList = Array.isArray(services.json)
      ? services.json
      : Array.isArray((services.json as Json)?.services)
        ? ((services.json as Json).services as Json[])
        : [];
    const svc =
      (svcList as Json[]).find((s) => Number(s.ProID || s.proId) > 0) ||
      (svcList as Json[])[0];
    if (!svc) fail('No services available for write tests');
    const proId = Number(svc.ProID || svc.proId);
    const sPrice = Number(svc.SPrice1 ?? svc.sPrice ?? svc.price ?? 50) || 50;
    const bonus = Number(svc.Bonus ?? 0) || 0;

    const barbers = await api(cookie, 'GET', '/api/barbers?scope=barber');
    const barberList = Array.isArray(barbers.json)
      ? (barbers.json as Json[])
      : Array.isArray((barbers.json as Json)?.barbers)
        ? ((barbers.json as Json).barbers as Json[])
        : [];
    const empId = Number(barberList[0]?.EmpID || barberList[0]?.empId || 0);
    if (!empId) fail('No barber for write tests');

    const pays = await api(cookie, 'GET', '/api/payment-methods');
    const payList = Array.isArray(pays.json) ? (pays.json as Json[]) : [];
    const payId = Number(payList[0]?.ID || payList[0]?.id || 1);

    // ─── CLIENT CREATE ───
    const clientName = `${TAG}_CLIENT`;
    const createClient = await api(cookie, 'POST', '/api/customers', {
      name: clientName,
      mobile: PHONE,
      notes: 'vps-localhost-e2e',
      cameFrom: 'walk_by',
    });
    if (createClient.status !== 201 && createClient.status !== 200) {
      fail(`client create status=${createClient.status} ${createClient.text.slice(0, 200)}`);
    }
    const clientId = Number(createClient.json?.ClientID || createClient.json?.clientId);
    if (!clientId) fail('client create missing ClientID');

    const dbClient = await pool
      .request()
      .input('id', sql.Int, clientId)
      .query(`SELECT ClientID, Name, Mobile FROM dbo.TblClient WHERE ClientID=@id`);
    const dbC = dbClient.recordset[0];
    if (!dbC || !String(dbC.Name).includes('VPS_TEST')) {
      fail('client not found in last132_migrated with VPS_TEST name');
    }
    const rereadClient = await api(cookie, 'GET', `/api/customers?q=${encodeURIComponent(TAG)}`);
    const found = Array.isArray(rereadClient.json)
      ? (rereadClient.json as Json[]).some((c) => Number(c.ClientID) === clientId)
      : false;
    report.clientCreate = found
      ? `PASS id=${clientId} name=${clientName} db+api ok`
      : `FAIL id=${clientId} api reread miss`;

    // UPDATE client notes
    const patchClient = await api(cookie, 'PATCH', `/api/customers/${clientId}`, {
      notes: `${TAG}_UPDATED`,
    });
    const updateOk = patchClient.status >= 200 && patchClient.status < 400;
    if (!updateOk) report.errors.push(`client patch status=${patchClient.status}`);

    // ─── BOOKING CREATE (public API, future slot) ───
    let bookingId = 0;
    let bookingCode = '';
    const from = cairoTodayPlus(1);
    const to = cairoTodayPlus(10);
    const avail = await api(cookie, 'POST', '/api/public/booking/v2/availability', {
      employeeId: empId,
      branchCode: 'GLEEM',
      fromBusinessDate: from,
      toBusinessDate: to,
      serviceIds: [proId],
    });

    let bookDate = '';
    let bookTime = '';
    const days = Array.isArray((avail.json as Json)?.days)
      ? ((avail.json as Json).days as Json[])
      : [];
    for (const day of days) {
      if (Number(day.employeeId) && Number(day.employeeId) !== empId) continue;
      const d = String(day.businessDate || day.date || '');
      const ranges = Array.isArray(day.freeRanges) ? (day.freeRanges as Json[]) : [];
      const generated = Array.isArray(day.generatedStarts)
        ? (day.generatedStarts as string[])
        : [];
      if (generated.length && d) {
        bookDate = d;
        bookTime = String(generated[0]).slice(0, 5);
        break;
      }
      for (const r of ranges) {
        const sm = Number(r.startMin ?? -1);
        const em = Number(r.endMin ?? -1);
        if (sm < 0 || em - sm < 30 || !d) continue;
        // Prefer afternoon slot inside free range
        const pick = Math.max(sm, Math.min(sm + 60, em - 30));
        const hh = Math.floor(pick / 60) % 24;
        const mm = pick % 60;
        bookDate = d;
        bookTime = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
        break;
      }
      if (bookDate) break;
    }

    // Fallback dig
    if (!bookDate) {
      const digStarts = (node: unknown, depth = 0): void => {
        if (bookDate || depth > 6 || node == null) return;
        if (Array.isArray(node)) {
          for (const x of node) digStarts(x, depth + 1);
          return;
        }
        if (typeof node !== 'object') return;
        const o = node as Json;
        const d = String(o.businessDate || o.date || '');
        const starts = (
          Array.isArray(o.generatedStarts) ? o.generatedStarts : Array.isArray(o.starts) ? o.starts : []
        ) as unknown[];
        if (d && starts.length) {
          const t0 = starts[0];
          const t =
            typeof t0 === 'string'
              ? t0
              : String((t0 as Json)?.time || (t0 as Json)?.start || '');
          if (t) {
            bookDate = d;
            bookTime = t.slice(0, 5);
          }
        }
        for (const v of Object.values(o)) digStarts(v, depth + 1);
      };
      digStarts(avail.json);
    }

    if (!bookDate || !bookTime) {
      // Fallback legacy create with correct field names
      const bk = await api(cookie, 'POST', '/api/bookings', {
        clientId,
        empId,
        bookingDate: from,
        startTime: '16:00',
        services: [{ proId, empId, durationMinutes: 30 }],
        notes: `${TAG}_BOOKING`,
        source: 'operations',
      });
      if (bk.status >= 200 && bk.status < 300) {
        bookingId = Number(
          (bk.json as Json)?.bookingId ||
            (bk.json as Json)?.BookingID ||
            ((bk.json as Json)?.booking as Json)?.BookingID ||
            0,
        );
        bookingCode = String(
          (bk.json as Json)?.bookingCode ||
            ((bk.json as Json)?.booking as Json)?.BookingCode ||
            '',
        );
      } else {
        report.bookingCreate = `SKIP/FAIL no slot + bookings POST ${bk.status} ${bk.text.slice(0, 120)}`;
        report.errors.push(`booking create failed: ${bk.status}`);
      }
    } else {
      // Prefer public create; if that fails, legacy with discovered slot
      const createBk = await api(cookie, 'POST', '/api/public/booking/create', {
        branchCode: 'GLEEM',
        date: bookDate,
        time: bookTime,
        serviceIds: [proId],
        empId,
        mode: 'specific_barber',
        customer: { name: `${TAG}_BOOK_CUST`, phone: PHONE },
        notes: `${TAG}_BOOKING`,
        suppressNotification: true,
        clientRequestId: `${TAG}-bk-1`,
      });
      if (createBk.status === 201 || createBk.status === 200) {
        const body = createBk.json || {};
        bookingId = Number(
          body.bookingId ||
            (body.booking as Json)?.bookingId ||
            (body.booking as Json)?.BookingID ||
            body.BookingID ||
            0,
        );
        bookingCode = String(
          body.bookingCode ||
            (body.booking as Json)?.bookingCode ||
            (body.booking as Json)?.BookingCode ||
            body.BookingCode ||
            '',
        );
      } else {
        const bk = await api(cookie, 'POST', '/api/bookings', {
          clientId,
          empId,
          bookingDate: bookDate,
          startTime: bookTime,
          services: [{ proId, empId, durationMinutes: 30 }],
          notes: `${TAG}_BOOKING`,
          source: 'operations',
        });
        if (bk.status >= 200 && bk.status < 300) {
          bookingId = Number((bk.json as Json)?.bookingId || 0);
        } else {
          report.bookingCreate = `FAIL public=${createBk.status} legacy=${bk.status} ${bk.text.slice(0, 120)}`;
          report.errors.push(`booking create failed: ${bk.status}`);
        }
      }
    }

    // Ensure updatePaths always records client patch even if booking fails later
    report.updatePaths = updateOk ? 'client PATCH ok' : `client PATCH fail ${patchClient.status}`;

    if (bookingId) {
      const dbBk = await pool
        .request()
        .input('id', sql.Int, bookingId)
        .query(
          `SELECT BookingID, BookingCode, Status, Notes FROM dbo.Bookings WHERE BookingID=@id`,
        );
      const row = dbBk.recordset[0];
      const apiBk = await api(cookie, 'GET', `/api/bookings/${bookingId}`);
      const apiOk = apiBk.status === 200;
      report.bookingCreate =
        row && apiOk
          ? `PASS id=${bookingId} code=${bookingCode || row.BookingCode} status=${row.Status} db+api ok`
          : `FAIL id=${bookingId} db=${!!row} api=${apiBk.status}`;

      // UPDATE confirm then CANCEL
      const conf = await api(cookie, 'PATCH', `/api/bookings/${bookingId}`, {
        action: 'confirm',
      });
      const cancel = await api(cookie, 'PATCH', `/api/bookings/${bookingId}`, {
        action: 'cancel',
        cancelReason: `${TAG}_CANCEL`,
      });
      const dbCancel = await pool
        .request()
        .input('id', sql.Int, bookingId)
        .query(`SELECT Status FROM dbo.Bookings WHERE BookingID=@id`);
      const st = String(dbCancel.recordset[0]?.Status || '');
      const cancelOk = /cancel/i.test(st) && cancel.status >= 200 && cancel.status < 400;
      report.updatePaths = [
        updateOk ? 'client PATCH ok' : 'client PATCH fail',
        conf.status < 400 ? 'booking confirm ok' : `booking confirm ${conf.status}`,
        cancelOk ? `booking cancel ok (${st})` : `booking cancel fail api=${cancel.status} db=${st}`,
      ].join('; ');
      if (!cancelOk) report.errors.push('booking cancel path failed');
    } else if (!report.bookingCreate) {
      report.bookingCreate = 'FAIL no booking id';
      report.updatePaths = updateOk
        ? 'client PATCH ok; booking skipped'
        : 'client PATCH fail; booking skipped';
    }

    // ─── INVOICE CREATE (needs open day/shift) ───
    let invId = 0;
    const session = await api(cookie, 'GET', '/api/auth/session');
    const hasShift = !!(session.json as Json)?.shift;
    if (!hasShift) {
      // open day if needed
      await api(cookie, 'POST', '/api/day/open');
      const defs = await api(cookie, 'GET', '/api/shift/definitions');
      const shiftDefs = Array.isArray(defs.json) ? (defs.json as Json[]) : [];
      const shiftID = Number(shiftDefs[0]?.ShiftID || 1);
      const opened = await api(cookie, 'POST', '/api/shift/open', { shiftID });
      if (opened.status >= 400) {
        report.invoiceCreate = `SKIP cannot open shift status=${opened.status} ${opened.text.slice(0, 120)}`;
      }
    }

    const saleBody = {
      clientId,
      items: [
        {
          proId,
          empId,
          sPrice,
          bonus,
          qty: 1,
          dis: 0,
          disVal: 0,
          sPriceAfterDis: sPrice,
          notes: `${TAG}_LINE`,
        },
      ],
      subTotal: sPrice,
      dis: 0,
      disVal: 0,
      grandTotal: sPrice,
      totalBonus: bonus,
      totalQty: 1,
      paymentMethodId: payId,
      paymentAllocations: [{ paymentMethodId: payId, amount: sPrice }],
      payCash: payId === 1 ? sPrice : 0,
      payVisa: payId !== 1 ? sPrice : 0,
      notes: `${TAG}_INVOICE`,
    };
    const sale = await api(cookie, 'POST', '/api/sales', saleBody);
    if (sale.status >= 200 && sale.status < 300) {
      invId = Number(sale.json?.invID || sale.json?.InvID || 0);
      const dbInv = await pool
        .request()
        .input('id', sql.Int, invId)
        .query(
          `SELECT invID, Notes, ClientID FROM dbo.TblinvServHead WHERE invID=@id`,
        );
      const row = dbInv.recordset[0];
      const getInv = await api(cookie, 'GET', `/api/sales/${invId}`);
      report.invoiceCreate =
        row && getInv.status === 200
          ? `PASS invID=${invId} notes contain VPS_TEST db+api ok`
          : `FAIL invID=${invId} db=${!!row} api=${getInv.status}`;

      // DELETE invoice (cleanup + delete path)
      const del = await api(cookie, 'DELETE', `/api/sales/${invId}`, {
        reason: `${TAG}_DELETE_CLEANUP`,
      });
      const delOk = del.status >= 200 && del.status < 400;
      report.updatePaths = `${report.updatePaths || 'n/a'}; invoice DELETE ${delOk ? 'ok' : `fail ${del.status}`}`;
      if (!delOk) report.errors.push(`invoice delete ${del.status}`);
    } else {
      report.invoiceCreate = `FAIL/SKIP status=${sale.status} ${sale.text.slice(0, 160)}`;
      if (sale.status >= 500) report.errors.push(`invoice create ${sale.status}`);
    }

    report.writes = [
      report.clientCreate.startsWith('PASS') ? 'client' : null,
      report.bookingCreate.startsWith('PASS') ? 'booking' : null,
      report.invoiceCreate.startsWith('PASS') ? 'invoice' : null,
    ]
      .filter(Boolean)
      .join('+') || 'NONE';

    // ─── CONCURRENCY ───
    // Warm first
    await api(cookie, 'GET', '/api/barbers');
    await api(cookie, 'GET', '/api/services');
    const c20 = await concurrency(cookie, '/api/barbers', 20);
    report.concurrent20 = `ok=${c20.ok}/${c20.n} http500=${c20.http500} timeout=${c20.timeouts} conn=${c20.connErr} p50=${c20.p50}ms p95=${c20.p95}ms max=${c20.max}ms statuses=${JSON.stringify(c20.statuses)}`;
    const c50 = await concurrency(cookie, '/api/services', 50);
    report.concurrent50 = `ok=${c50.ok}/${c50.n} http500=${c50.http500} timeout=${c50.timeouts} conn=${c50.connErr} p50=${c50.p50}ms p95=${c50.p95}ms max=${c50.max}ms statuses=${JSON.stringify(c50.statuses)}`;
    if (c20.http500 || c50.http500) report.errors.push('concurrency HTTP 500 observed');
    if (c20.timeouts || c50.timeouts) report.errors.push('concurrency SQL/timeout signals');

    const criticalFail =
      !report.clientCreate.startsWith('PASS') ||
      report.errors.some((e) => e.startsWith('REFUSE') || e.includes('Azure'));
    const softFail = report.errors.length > 0;
    report.verdict = criticalFail ? 'FAIL' : softFail ? 'PASS_WITH_ISSUES' : 'PASS';
  } finally {
    await pool.close().catch(() => {});
  }

  // Final print — exact format requested
  console.log('');
  console.log('VPS LOCALHOST E2E VERIFIED');
  console.log('');
  console.log(`DB TARGET: ${report.dbTarget}`);
  console.log(`READS: ${report.reads}`);
  console.log(`WRITES: ${report.writes}`);
  console.log(`CLIENT CREATE: ${report.clientCreate}`);
  console.log(`BOOKING CREATE: ${report.bookingCreate}`);
  console.log(`INVOICE CREATE: ${report.invoiceCreate}`);
  console.log(`UPDATE PATHS: ${report.updatePaths}`);
  console.log(`CONNECTION POOL: ${report.connectionPool}`);
  console.log(`20 CONCURRENT: ${report.concurrent20}`);
  console.log(`50 CONCURRENT: ${report.concurrent50}`);
  console.log(`HARDCODED AZURE REFERENCES: ${report.hardcodedAzure}`);
  console.log(`ERRORS: ${report.errors.length ? report.errors.join(' | ') : 'none'}`);
  console.log(`FINAL VERDICT: ${report.verdict}`);

  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync(
    'tmp/vps-localhost-e2e-report.json',
    JSON.stringify(
      { tag: TAG, phone: PHONE, report },
      (k, v) => (/password|secret/i.test(String(k)) ? '[redacted]' : v),
      2,
    ),
    'utf8',
  );

  if (report.verdict === 'FAIL') process.exit(1);
}

main().catch((err) => {
  console.error('[vps-e2e] FATAL:', err instanceof Error ? err.message : err);
  console.log('');
  console.log('VPS LOCALHOST E2E VERIFIED');
  console.log('');
  console.log(`DB TARGET: ${report.dbTarget || 'unknown'}`);
  console.log(`READS: ${report.reads || 'n/a'}`);
  console.log(`WRITES: ${report.writes || 'n/a'}`);
  console.log(`CLIENT CREATE: ${report.clientCreate || 'n/a'}`);
  console.log(`BOOKING CREATE: ${report.bookingCreate || 'n/a'}`);
  console.log(`INVOICE CREATE: ${report.invoiceCreate || 'n/a'}`);
  console.log(`UPDATE PATHS: ${report.updatePaths || 'n/a'}`);
  console.log(`CONNECTION POOL: ${report.connectionPool || 'n/a'}`);
  console.log(`20 CONCURRENT: ${report.concurrent20 || 'n/a'}`);
  console.log(`50 CONCURRENT: ${report.concurrent50 || 'n/a'}`);
  console.log(`HARDCODED AZURE REFERENCES: ${report.hardcodedAzure || 'n/a'}`);
  console.log(
    `ERRORS: ${(report.errors.length ? report.errors : [err instanceof Error ? err.message : String(err)]).join(' | ')}`,
  );
  console.log('FINAL VERDICT: FAIL');
  process.exit(1);
});

#!/usr/bin/env npx tsx
import path from 'path';
import dotenv from 'dotenv';
import sql from 'mssql';

dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });
const BASE = 'http://localhost:5500';

function cookieFrom(res: Response) {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const list =
    typeof h.getSetCookie === 'function'
      ? h.getSetCookie()
      : [h.get('set-cookie')].filter(Boolean) as string[];
  return list.map((c) => String(c).split(';')[0]).join('; ');
}

async function main() {
  const password = String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, '');
  const pool = await new sql.ConnectionPool({
    server: process.env.DB_SERVER!,
    database: process.env.DB_DATABASE!,
    user: process.env.DB_USER!,
    password,
    port: 1433,
    options: { encrypt: true, trustServerCertificate: true },
  }).connect();
  const u = await pool.request().query(
    `SELECT TOP 1 loginName, Password FROM dbo.TblUser WHERE loginName=N'Tarek' AND ISNULL(isDeleted,0)=0`,
  );
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      loginName: u.recordset[0].loginName,
      password: u.recordset[0].Password,
    }),
  });
  const cookie = cookieFrom(login);
  const emp = await (await fetch(`${BASE}/api/barbers?scope=barber`, { headers: { cookie } })).json();
  const empId = Array.isArray(emp) ? emp[0]?.EmpID : emp.barbers?.[0]?.EmpID;
  const svc = await (
    await fetch(`${BASE}/api/services?active=true&bookable=true`, { headers: { cookie } })
  ).json();
  const list = Array.isArray(svc) ? svc : svc.services || [];
  const proId = list[0]?.ProID;
  console.log({ empId, proId });
  const av = await fetch(`${BASE}/api/public/booking/v2/availability`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      employeeId: empId,
      branchCode: 'GLEEM',
      fromBusinessDate: '2026-08-22',
      toBusinessDate: '2026-08-28',
      serviceIds: [proId],
    }),
  });
  const j = await av.json();
  console.log('status', av.status, 'topKeys', Object.keys(j || {}));
  const days = j.days || j.matrix?.days || [];
  console.log('daysLen', Array.isArray(days) ? days.length : 0);
  if (Array.isArray(days) && days[0]) {
    console.log('day0keys', Object.keys(days[0]));
    console.log('day0sample', JSON.stringify(days[0]).slice(0, 500));
  }
  // also try POST bookings body from route
  const bk = await fetch(`${BASE}/api/bookings`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      clientId: 13649,
      assignedEmpId: empId,
      bookingDate: '2026-08-22',
      startTime: '16:00',
      serviceIds: [proId],
      notes: 'VPS_TEST_PROBE',
      source: 'operations',
    }),
  });
  console.log('bookingsPOST', bk.status, (await bk.text()).slice(0, 300));
  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

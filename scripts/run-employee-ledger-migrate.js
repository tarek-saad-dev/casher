#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Run Employee Ledger schema migration via HTTP API.
 *
 * Auth (pick one):
 *   1. ADMIN_SETUP_SECRET env → sends x-admin-setup-secret header
 *   2. POS_SESSION_COOKIE env → sends Cookie: pos_session=...
 *   3. Log in at /admin/hr in the browser, copy pos_session cookie value into POS_SESSION_COOKIE
 *
 * Usage:
 *   node scripts/run-employee-ledger-migrate.js
 *   node scripts/run-employee-ledger-migrate.js http://localhost:5500/api/admin/hr/employee-ledger/migrate
 *
 * PowerShell with setup secret:
 *   $env:ADMIN_SETUP_SECRET="your-secret"; node scripts/run-employee-ledger-migrate.js
 */

const endpoint = process.argv[2] || 'http://localhost:5500/api/admin/hr/employee-ledger/migrate';

function buildHeaders() {
  const headers = { 'Content-Type': 'application/json' };

  const setupSecret = process.env.ADMIN_SETUP_SECRET;
  if (setupSecret) {
    headers['x-admin-setup-secret'] = setupSecret;
    return headers;
  }

  const sessionCookie = process.env.POS_SESSION_COOKIE;
  if (sessionCookie) {
    const value = sessionCookie.includes('pos_session=')
      ? sessionCookie
      : `pos_session=${sessionCookie}`;
    headers.Cookie = value;
    return headers;
  }

  return headers;
}

async function main() {
  const headers = buildHeaders();

  if (!headers['x-admin-setup-secret'] && !headers.Cookie) {
    console.warn(
      'Warning: no ADMIN_SETUP_SECRET or POS_SESSION_COOKIE set — request will likely return 401.\n' +
      'Set ADMIN_SETUP_SECRET (matches server .env) or copy pos_session cookie after logging in.\n',
    );
  }

  console.log(`POST ${endpoint}`);
  const res = await fetch(endpoint, { method: 'POST', headers });
  const text = await res.text();

  let payload = text;
  try {
    payload = JSON.parse(text);
  } catch {
    // leave as text
  }

  console.log(`status: ${res.status}`);
  console.log(typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2));

  if (res.status === 401) {
    console.error(
      '\n401 Unauthorized — authenticate using one of:\n' +
      '  • $env:ADMIN_SETUP_SECRET="<value from .env>"; node scripts/run-employee-ledger-migrate.js\n' +
      '  • $env:POS_SESSION_COOKIE="<pos_session cookie value>"; node scripts/run-employee-ledger-migrate.js\n' +
      '  • curl with browser session: curl -X POST ... -H "Cookie: pos_session=..."\n',
    );
    process.exit(1);
  }

  if (!res.ok) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Migration request failed:', err?.message || err);
  process.exit(1);
});

#!/usr/bin/env node
const fs = require('fs');
const path = '/home/casher/app/.env.local';
const text = fs.readFileSync(path, 'utf8');
const env = {};
for (const line of text.split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i < 0) continue;
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[t.slice(0, i).trim()] = v;
}
const token = String(env.WHATSAPP_INBOX_WEBHOOK_TOKEN || '').trim();
(async () => {
  const noAuth = await fetch('http://127.0.0.1:3000/api/internal/messaging/inbox/whatsapp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const bad = await fetch('http://127.0.0.1:3000/api/internal/messaging/inbox/whatsapp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: 'Bearer ' + token,
    },
    body: JSON.stringify({ provider: 'whatsapp-web' }),
  });
  const badBody = await bad.json().catch(() => null);
  const wa = await fetch('http://127.0.0.1:3001/api/whatsapp/status')
    .then((r) => r.json())
    .catch((e) => ({ error: String(e) }));
  console.log(
    JSON.stringify(
      {
        noAuthStatus: noAuth.status,
        badBodyStatus: bad.status,
        badCode: badBody && badBody.code,
        waTransport: wa.transport,
        waReady: wa.ready,
        waConnected: wa.connected,
        waQrRequired: wa.qrRequired,
        webhookConfigured: wa.inbox && wa.inbox.deliveryWorker && wa.inbox.deliveryWorker.webhookConfigured,
      },
      null,
      2,
    ),
  );
})().catch((e) => {
  console.error(String(e));
  process.exit(2);
});

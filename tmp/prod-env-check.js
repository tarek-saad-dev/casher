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
  const k = t.slice(0, i).trim();
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  env[k] = v;
}
function get(...keys) {
  for (const k of keys) {
    if (env[k] != null && String(env[k]).trim() !== '') return String(env[k]).trim();
  }
  return '';
}
const out = {
  geminiKeySet: Boolean(get('GEMINI_API_KEY')),
  geminiModel: get('GEMINI_MODEL') || '(unset)',
  inboxTokenSet: Boolean(get('WHATSAPP_INBOX_WEBHOOK_TOKEN')),
  waBase: get('WHATSAPP_API_BASE_URL'),
  waEnabled: get('WHATSAPP_INTEGRATION_ENABLED'),
  dbClass: get('HAWAI_DB_CLASS') || null,
  dbServer: get('DB_SERVER', 'LOCAL_DB_SERVER') || null,
  dbPort: get('DB_PORT', 'LOCAL_DB_PORT') || null,
  dbName: get('DB_DATABASE', 'LOCAL_DB_NAME', 'DB_NAME') || null,
};
console.log(JSON.stringify(out, null, 2));

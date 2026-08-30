#!/bin/bash
set -euo pipefail
hostname
cd /home/casher/app
node tmp/prod-env-check.js 2>/dev/null || node - <<'NODE'
const fs = require('fs');
const text = fs.readFileSync('/home/casher/app/.env.local', 'utf8');
const env = {};
for (const line of text.split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i < 0) continue;
  const k = t.slice(0, i).trim();
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[k] = v;
}
function get(...keys) {
  for (const k of keys) if (env[k]) return env[k];
  return '';
}
console.log(JSON.stringify({
  db: get('DB_DATABASE', 'LOCAL_DB_NAME', 'DB_NAME'),
  server: get('DB_SERVER', 'LOCAL_DB_SERVER'),
  port: get('DB_PORT', 'LOCAL_DB_PORT'),
  class: get('HAWAI_DB_CLASS'),
  concierge: get('SALON_CONCIERGE_BRAIN_V1') || '(unset)',
  v4: get('CUSTOMER_LED_CONVERSATION_V4') || '(unset)',
  head: require('child_process').execSync('git rev-parse HEAD', { cwd: '/home/casher/app' }).toString().trim(),
}, null, 2));
NODE

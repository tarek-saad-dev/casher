/**
 * Ensure SESSION_SECRET and CRON_SECRET exist in .env.local.
 * Never prints secret values.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const envPath = path.join(process.cwd(), '.env.local');
let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

function hasNonEmpty(key) {
  const re = new RegExp(`^${key}=(.*)$`, 'm');
  const m = text.match(re);
  if (!m) return false;
  let v = m[1].trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  return v.length > 0;
}

const updates = [];
if (!hasNonEmpty('SESSION_SECRET')) {
  updates.push(`SESSION_SECRET=${crypto.randomBytes(32).toString('base64url')}`);
}
if (!hasNonEmpty('CRON_SECRET')) {
  updates.push(`CRON_SECRET=${crypto.randomBytes(32).toString('base64url')}`);
}

if (updates.length > 0) {
  if (text.length && !text.endsWith('\n')) text += '\n';
  text +=
    '\n# Generated for Phase 1B local verification (do not commit)\n' +
    updates.join('\n') +
    '\n';
  fs.writeFileSync(envPath, text, 'utf8');
}

console.log(
  JSON.stringify({
    generatedSessionSecret: updates.some((u) => u.startsWith('SESSION_SECRET=')),
    generatedCronSecret: updates.some((u) => u.startsWith('CRON_SECRET=')),
    sessionSecretConfigured: true,
    cronSecretConfigured: true,
    entropyBitsPerGeneratedSecret: 256,
    envLocalPath: '.env.local',
  }),
);

import crypto from 'crypto';

/** Stored idempotency key columns are NVARCHAR(128). */
const MAX_STORED_KEY_LENGTH = 128;

/**
 * DRVO-013: client-supplied idempotency keys are stored in global tables. Namespacing them with
 * the authoritative tenant (`t:{tenant}:{key}`) makes identical client keys from two tenants
 * distinct rows, so they can neither replay nor block each other. Keys that would not fit are
 * replaced by a SHA-256 digest to keep uniqueness instead of truncating.
 */
export function namespacedRequestKey(
  tenantId: string,
  key: string | null | undefined,
): string | null | undefined {
  const raw = typeof key === 'string' ? key.trim() : '';
  if (!raw) return key;
  const tenant = String(tenantId ?? '').trim().toLowerCase();
  if (!tenant) throw new Error('namespacedRequestKey requires an authoritative tenantId');
  const prefix = `t:${tenant}:`;
  const clientKey = raw.toLowerCase().startsWith(prefix) ? raw.slice(prefix.length) : raw;
  const candidate = `${prefix}${clientKey}`;
  if (candidate.length <= MAX_STORED_KEY_LENGTH) return candidate;
  return `${prefix}h:${crypto.createHash('sha256').update(clientKey).digest('hex')}`;
}

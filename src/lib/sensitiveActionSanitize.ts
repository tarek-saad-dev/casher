/**
 * Sensitive data sanitization for audit logging.
 *
 * Recursively removes or masks sensitive keys before serializing audit data.
 * Never store passwords, hashes, tokens, cookies, authorization headers,
 * secrets, or connection strings in audit JSON.
 */

export const DEFAULT_SENSITIVE_KEYS = [
  'password',
  'passwordHash',
  'password_hash',
  'hashedPassword',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'cookie',
  'cookies',
  'authorization',
  'authHeader',
  'secret',
  'secretKey',
  'apiKey',
  'api_key',
  'connectionString',
  'connection_string',
  'session',
  'sessionPayload',
  'privateKey',
  'private_key',
];

export const MASKED_VALUE = '***REDACTED***';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSensitiveKey(key: string, extraKeys?: string[]): boolean {
  const lower = key.toLowerCase();
  const all = extraKeys ? [...DEFAULT_SENSITIVE_KEYS, ...extraKeys] : DEFAULT_SENSITIVE_KEYS;
  return all.some((k) => lower === k.toLowerCase());
}

export function sanitizeForAudit(
  value: unknown,
  extraSensitiveKeys?: string[],
  seen = new WeakSet<object>(),
): unknown {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForAudit(item, extraSensitiveKeys, seen));
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);

    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (isSensitiveKey(key, extraSensitiveKeys)) {
        sanitized[key] = MASKED_VALUE;
      } else {
        sanitized[key] = sanitizeForAudit(val, extraSensitiveKeys, seen);
      }
    }
    return sanitized;
  }

  // Functions, symbols, etc.
  return undefined;
}

export function sanitizeRequestHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (isSensitiveKey(key)) {
      result[key] = MASKED_VALUE;
    } else {
      result[key] = sanitizeForAudit(value, undefined, new WeakSet());
    }
  }
  return result;
}

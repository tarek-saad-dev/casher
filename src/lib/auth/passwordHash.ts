import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'crypto';

/**
 * Compact scrypt format that fits the legacy `TblUser.Password nvarchar(50)` column:
 *   s1$<salt: 8 bytes base64url, 11 chars>$<key: 24 bytes base64url, 32 chars>  (47 chars)
 */
export const PASSWORD_HASH_PREFIX = 's1$';
export const PASSWORD_HASH_MAX_LENGTH = 50;

const SALT_BYTES = 8;
const KEY_BYTES = 24;
const SCRYPT_OPTIONS: ScryptOptions = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const HASH_PATTERN = /^s1\$([A-Za-z0-9_-]{11})\$([A-Za-z0-9_-]{32})$/;

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize('NFC'), salt, KEY_BYTES, SCRYPT_OPTIONS, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export function isPasswordHash(stored: string | null | undefined): boolean {
  return typeof stored === 'string' && HASH_PATTERN.test(stored);
}

export async function hashPassword(password: string): Promise<string> {
  if (!password) throw new Error('PASSWORD_REQUIRED');
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt);
  return `${PASSWORD_HASH_PREFIX}${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export type PasswordVerification = {
  ok: boolean;
  /** True when the stored value is legacy plaintext and should be replaced with a hash. */
  needsUpgrade: boolean;
};

function constantTimeTextEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<PasswordVerification> {
  if (!password || typeof stored !== 'string' || stored.length === 0) {
    return { ok: false, needsUpgrade: false };
  }
  const match = HASH_PATTERN.exec(stored);
  if (match) {
    const salt = Buffer.from(match[1], 'base64url');
    const expected = Buffer.from(match[2], 'base64url');
    const actual = await scrypt(password, salt);
    return { ok: timingSafeEqual(actual, expected), needsUpgrade: false };
  }
  // Legacy plaintext rows were matched by SQL `=` under a case-insensitive collation that ignores
  // trailing spaces; keep those semantics so nobody is locked out before their row is upgraded.
  const ok = constantTimeTextEqual(
    password.replace(/\s+$/, '').toLowerCase(),
    stored.replace(/\s+$/, '').toLowerCase(),
  );
  return { ok, needsUpgrade: ok };
}

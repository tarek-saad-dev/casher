// ──── Server-side session helpers ────
// Uses a signed cookie (base64-encoded JSON + HMAC) for simplicity.
// No external JWT library needed.

import { cookies } from 'next/headers';
import crypto from 'crypto';
import {
  BRANCH_SESSION_VERSION,
  type SessionPayload,
  type SessionUser,
} from './session-types';

const COOKIE_NAME = 'pos_session';
const MAX_AGE = 24 * 60 * 60; // 24 hours in seconds

function resolveSessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.SESSION_SECRET?.trim();
  if (configured) return configured;
  if (env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be configured in production');
  }
  // Development-only fallback — production refuses above.
  return 'hawai-pos-secret-key-change-in-prod';
}

export function getSessionSecretForTests(env: NodeJS.ProcessEnv = process.env): string {
  return resolveSessionSecret(env);
}

function sign(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function encodeSessionPayload(
  data: SessionPayload,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const secret = resolveSessionSecret(env);
  const json = Buffer.from(JSON.stringify(data)).toString('base64url');
  const sig = sign(json, secret);
  return `${json}.${sig}`;
}

export type DecodeSessionResult =
  | { ok: true; payload: SessionPayload }
  | { ok: false; reason: 'invalid' | 'tampered' | 'expired' | 'legacy' | 'unsupported_version' };

export function decodeSessionToken(
  token: string,
  env: NodeJS.ProcessEnv = process.env,
  nowSec: number = Math.floor(Date.now() / 1000),
  maxAgeSec: number = MAX_AGE,
): DecodeSessionResult {
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'invalid' };
  const [json, sig] = parts;
  const secret = resolveSessionSecret(env);
  if (sign(json, secret) !== sig) return { ok: false, reason: 'tampered' };

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(Buffer.from(json, 'base64url').toString('utf-8')) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  if (typeof raw.iat !== 'number' || typeof raw.UserID !== 'number') {
    return { ok: false, reason: 'invalid' };
  }
  if (nowSec - raw.iat > maxAgeSec) return { ok: false, reason: 'expired' };

  const hasBranchClaim =
    typeof raw.ActiveBranchID === 'number' &&
    typeof raw.ActiveBranchCode === 'string' &&
    raw.BranchSessionVersion != null;

  if (!hasBranchClaim) return { ok: false, reason: 'legacy' };
  if (raw.BranchSessionVersion !== BRANCH_SESSION_VERSION) {
    return { ok: false, reason: 'unsupported_version' };
  }

  return {
    ok: true,
    payload: {
      UserID: raw.UserID as number,
      UserName: String(raw.UserName ?? ''),
      UserLevel: (raw.UserLevel === 'admin' ? 'admin' : 'user'),
      ActiveBranchID: raw.ActiveBranchID as number,
      ActiveBranchCode: String(raw.ActiveBranchCode),
      BranchSessionVersion: BRANCH_SESSION_VERSION,
      iat: raw.iat as number,
    },
  };
}

export async function createSession(user: SessionUser): Promise<void> {
  if (
    user.ActiveBranchID == null ||
    !user.ActiveBranchCode ||
    user.BranchSessionVersion !== BRANCH_SESSION_VERSION
  ) {
    throw new Error('createSession requires Phase 1B branch claims');
  }
  const payload: SessionPayload = {
    UserID: user.UserID,
    UserName: user.UserName,
    UserLevel: user.UserLevel,
    ActiveBranchID: user.ActiveBranchID,
    ActiveBranchCode: user.ActiveBranchCode,
    BranchSessionVersion: BRANCH_SESSION_VERSION,
    iat: Math.floor(Date.now() / 1000),
  };
  const token = encodeSessionPayload(payload);
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  });
}

async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function getSessionPayload(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const cookie = jar.get(COOKIE_NAME);
  if (!cookie?.value) return null;
  const decoded = decodeSessionToken(cookie.value);
  if (!decoded.ok) {
    if (
      decoded.reason === 'legacy' ||
      decoded.reason === 'unsupported_version' ||
      decoded.reason === 'expired' ||
      decoded.reason === 'tampered'
    ) {
      await clearSessionCookie();
    }
    return null;
  }
  return decoded.payload;
}

export async function getSession(): Promise<SessionUser | null> {
  const payload = await getSessionPayload();
  if (!payload) return null;
  return {
    UserID: payload.UserID,
    UserName: payload.UserName,
    UserLevel: payload.UserLevel,
    ActiveBranchID: payload.ActiveBranchID,
    ActiveBranchCode: payload.ActiveBranchCode,
    BranchSessionVersion: payload.BranchSessionVersion,
  };
}

export async function destroySession(): Promise<void> {
  await clearSessionCookie();
}

export { COOKIE_NAME, MAX_AGE as SESSION_MAX_AGE, BRANCH_SESSION_VERSION };

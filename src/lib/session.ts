// ──── Server-side session helpers ────
// Uses a signed cookie (base64-encoded JSON + HMAC) for simplicity.
// No external JWT library needed.
//
// Cookie mutation (set/delete) is only safe in Route Handlers / Server Actions.
// getSessionPayload / getSession are read-only and safe in Server Components.

import { cookies } from 'next/headers';
import crypto from 'crypto';
import {
  BRANCH_SESSION_VERSION,
  type SessionPayload,
  type SessionUser,
} from './session-types';

const COOKIE_NAME = 'pos_session';
const MAX_AGE = 24 * 60 * 60; // 24 hours in seconds

export class SessionConfigError extends Error {
  readonly code = 'SESSION_CONFIG_ERROR' as const;
  constructor(message: string) {
    super(message);
    this.name = 'SessionConfigError';
  }
}

function resolveSessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.SESSION_SECRET?.trim();
  if (configured) return configured;
  if (env.NODE_ENV === 'production') {
    throw new SessionConfigError('SESSION_SECRET must be configured in production');
  }
  // Development-only fallback — production refuses above.
  return 'hawai-pos-secret-key-change-in-prod';
}

/** Fail fast before DB work when production cannot mint a session cookie. */
export function assertSessionSecretConfigured(
  env: NodeJS.ProcessEnv = process.env,
): void {
  resolveSessionSecret(env);
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

/** Read-only: returns the raw cookie value if present. Does not mutate cookies. */
export async function readSessionCookie(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(COOKIE_NAME)?.value ?? null;
}

/**
 * Read-only verification of the current request cookie.
 * Safe in Server Components — never sets or deletes cookies.
 */
export async function verifySessionCookie(): Promise<DecodeSessionResult | { ok: false; reason: 'missing' }> {
  const token = await readSessionCookie();
  if (!token) return { ok: false, reason: 'missing' };
  return decodeSessionToken(token);
}

/**
 * Create / overwrite the session cookie.
 * Call only from Route Handlers or Server Actions.
 */
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
  await setSessionCookie(token);
}

/**
 * Set the session cookie value.
 * Call only from Route Handlers or Server Actions.
 */
export async function setSessionCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
  });
}

/**
 * Delete the session cookie.
 * Call only from Route Handlers or Server Actions — never from Server Components.
 */
export async function deleteSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

/**
 * Read-only session payload.
 * Invalid/legacy/expired cookies return null without mutating cookies.
 */
export async function getSessionPayload(): Promise<SessionPayload | null> {
  const verified = await verifySessionCookie();
  if (!verified.ok) return null;
  return verified.payload;
}

/** Read-only session user. Safe in Server Components. */
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

/**
 * Destroy the session cookie.
 * Call only from Route Handlers or Server Actions.
 */
export async function destroySession(): Promise<void> {
  await deleteSessionCookie();
}

export { COOKIE_NAME, MAX_AGE as SESSION_MAX_AGE, BRANCH_SESSION_VERSION };

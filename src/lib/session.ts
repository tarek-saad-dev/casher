// ──── Server-side session helpers ────
// Uses a signed cookie (base64-encoded JSON + HMAC) for simplicity.
// No external JWT library needed.

import { cookies } from 'next/headers';
import crypto from 'crypto';
import type { SessionPayload, SessionUser } from './session-types';

const COOKIE_NAME = 'pos_session';
const SECRET = process.env.SESSION_SECRET || 'hawai-pos-secret-key-change-in-prod';
const MAX_AGE = 24 * 60 * 60; // 24 hours in seconds

function sign(payload: string): string {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

function encode(data: SessionPayload): string {
  const json = Buffer.from(JSON.stringify(data)).toString('base64url');
  const sig = sign(json);
  return `${json}.${sig}`;
}

function decode(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [json, sig] = parts;
  if (sign(json) !== sig) return null;
  try {
    return JSON.parse(Buffer.from(json, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
}

export async function createSession(user: SessionUser): Promise<void> {
  const payload: SessionPayload = {
    UserID: user.UserID,
    UserName: user.UserName,
    UserLevel: user.UserLevel,
    iat: Math.floor(Date.now() / 1000),
  };
  const token = encode(payload);
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const cookie = jar.get(COOKIE_NAME);
  if (!cookie?.value) return null;
  const payload = decode(cookie.value);
  if (!payload) return null;
  // Check expiry
  const age = Math.floor(Date.now() / 1000) - payload.iat;
  if (age > MAX_AGE) return null;
  return {
    UserID: payload.UserID,
    UserName: payload.UserName,
    UserLevel: payload.UserLevel,
  };
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export { COOKIE_NAME };

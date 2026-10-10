import crypto from 'crypto';

/** Webhook tokens are never stored; only their SHA-256 hex digest identifies the channel. */
export function hashChannelWebhookToken(token: string): string {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

/** Bearer token from an Authorization header, or null. */
export function extractBearerToken(authorization: string | null | undefined): string | null {
  const raw = String(authorization ?? '').trim();
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  const token = match?.[1]?.trim() ?? '';
  return token.length > 0 ? token : null;
}

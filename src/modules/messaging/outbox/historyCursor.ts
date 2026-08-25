import { MessageOutboxError } from '../domain/outboxTypes';

export type MessageHistoryCursorValue = {
  createdAt: string;
  id: number;
};

export function encodeMessageHistoryCursor(createdAt: string, id: number): string {
  return Buffer.from(JSON.stringify({ t: createdAt, i: id }), 'utf8').toString('base64url');
}

export function decodeMessageHistoryCursor(cursor: string): MessageHistoryCursorValue {
  const raw = String(cursor ?? '').trim();
  if (!raw) {
    throw new MessageOutboxError('History cursor is empty', 'INVALID_CURSOR');
  }
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as { t?: unknown; i?: unknown };
    const createdAt = typeof parsed.t === 'string' ? parsed.t : '';
    const id = typeof parsed.i === 'number' ? parsed.i : Number(parsed.i);
    const createdMs = Date.parse(createdAt);
    if (!createdAt || Number.isNaN(createdMs) || !Number.isFinite(id) || id <= 0) {
      throw new Error('invalid cursor payload');
    }
    return { createdAt, id };
  } catch {
    throw new MessageOutboxError('History cursor is invalid', 'INVALID_CURSOR');
  }
}

/**
 * Deterministic WhatsApp contact identity for conversation resolution.
 * Prefers stable remote JID from adapter payload when available.
 */
export function extractJidFromRawPayload(rawPayload: string | null): string | null {
  if (rawPayload == null || rawPayload.trim() === '') return null;
  try {
    const parsed = JSON.parse(rawPayload) as Record<string, unknown>;
    const candidates = [
      parsed.remoteJid,
      parsed.remoteJidAlt,
      parsed.chatId,
      parsed.from,
      parsed.senderJid,
    ];
    for (const value of candidates) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (!trimmed || trimmed.endsWith('@g.us')) continue;
      return trimmed;
    }
  } catch {
    return null;
  }
  return null;
}

function digitsOnly(value: string): string {
  return String(value ?? '').replace(/\D/g, '');
}

function canonicalizePhoneDigits(digits: string): string | null {
  const d = digitsOnly(digits);
  if (d.length < 8) return null;
  if (d.length >= 10) return d.slice(-12);
  return d;
}

function jidToContactDigits(jid: string): string | null {
  const local = jid.split('@')[0] ?? '';
  const digits = digitsOnly(local);
  if (digits.length < 8) return null;
  return canonicalizePhoneDigits(digits);
}

/**
 * Canonical external contact key used for conversation uniqueness.
 * Does not mutate stored inbox phone — only identity resolution.
 */
export function resolveExternalContactKey(input: {
  phone: string;
  rawPayload: string | null;
}): string {
  const jid = extractJidFromRawPayload(input.rawPayload);
  if (jid) {
    const fromJid = jidToContactDigits(jid);
    if (fromJid) return fromJid;
  }

  const collapsed = String(input.phone ?? '').trim().replace(/\s+/g, '');
  const digits = canonicalizePhoneDigits(collapsed);
  if (digits) return digits;

  const fallback = collapsed.toLowerCase();
  if (!fallback) {
    throw new Error('Cannot resolve external contact key from empty phone');
  }
  return fallback.slice(0, 100);
}

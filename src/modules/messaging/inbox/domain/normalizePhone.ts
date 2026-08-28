/** Trim and collapse whitespace without stripping valid phone characters. */
export function normalizeInboxPhone(phone: string): string {
  return String(phone ?? '')
    .trim()
    .replace(/\s+/g, '');
}

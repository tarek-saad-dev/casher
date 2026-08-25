/** Trim phone; return digits-only for idempotency keys. */
export function normalizePhoneDigits(phone: string): string {
  return String(phone ?? '').replace(/\D/g, '');
}

export function normalizePhoneDisplay(phone: string): string {
  return String(phone ?? '').trim();
}

export function isValidCampaignPhone(phone: string): boolean {
  return normalizePhoneDigits(phone).length >= 8;
}

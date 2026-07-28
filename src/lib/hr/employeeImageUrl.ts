import { isSafePublicAssetPath } from '@/lib/booking/publicBookingServicePolicy';

/** Validate employee ImageUrl for admin save (relative public assets or http(s) e.g. Cloudinary). */
export function normalizeEmployeeImageUrlInput(
  raw: string | null | undefined,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw == null) return { ok: true, value: null };
  const trimmed = String(raw).trim();
  if (!trimmed) return { ok: true, value: null };

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return { ok: false, error: 'ImageUrl يجب أن يكون رابط http(s)' };
      }
      return { ok: true, value: u.toString() };
    } catch {
      return { ok: false, error: 'رابط الصورة غير صالح' };
    }
  }

  if (isSafePublicAssetPath(trimmed)) {
    return { ok: true, value: trimmed };
  }

  return {
    ok: false,
    error:
      'ImageUrl يجب أن يكون رابط Cloudinary/http(s) أو مسار صورة عامة مثل /barber-ziad.jpg',
  };
}

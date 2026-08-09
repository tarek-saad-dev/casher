/**
 * Parse a failed fetch Response into a short user-facing Arabic/English message.
 * Never returns raw HTML (Next error pages / login documents).
 */
export async function readFetchErrorMessage(
  res: Response,
  fallback = 'فشل الطلب',
): Promise<string> {
  const statusHint =
    res.status === 401
      ? 'غير مصرح — يجب تسجيل الدخول'
      : res.status === 403
        ? 'غير مصرح — لا تملك صلاحية تنفيذ هذا الإجراء'
        : `فشل الطلب (HTTP ${res.status})`;

  try {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = (await res.json()) as { error?: unknown; message?: unknown };
      if (typeof data.error === 'string' && data.error.trim()) return data.error.trim();
      if (typeof data.message === 'string' && data.message.trim()) {
        return data.message.trim();
      }
      return statusHint;
    }

    const text = (await res.text()).trim();
    if (!text) return statusHint;
    if (
      text.startsWith('<!DOCTYPE') ||
      text.startsWith('<!doctype') ||
      text.startsWith('<html') ||
      text.startsWith('<HTML')
    ) {
      return statusHint;
    }
    return text.length > 280 ? `${text.slice(0, 280)}…` : text;
  } catch {
    return fallback || statusHint;
  }
}

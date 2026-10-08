/** JSON fetch for operator / tenant-admin screens; throws Error(message [code]) on non-2xx. */
export async function platformFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
    const code = typeof body.code === 'string' ? ` [${body.code}]` : '';
    throw new Error(`${msg}${code}`);
  }
  return body as T;
}

export const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  trial: 'تجريبي',
  active: 'نشط',
  past_due: 'متأخر السداد',
  suspended: 'موقوف',
  cancelled: 'ملغي',
};

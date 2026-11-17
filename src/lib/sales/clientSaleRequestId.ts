/**
 * Browser-side pending POST /api/sales UUID. It survives an uncertain network
 * response and a SAME-TAB reload (sessionStorage), so a cashier retry cannot
 * silently become a new invoice with a new UUID.
 *
 * An explicitly chosen New Invoice discards it after staff reconciles the
 * uncertain payment; never infer success from a timeout or a rejected response.
 */
export const PENDING_SALE_REQUEST_KEY = 'cut-pos:pending-sale-request-id:v1';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readPending(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const token = window.sessionStorage.getItem(PENDING_SALE_REQUEST_KEY);
    return typeof token === 'string' && UUID_V4.test(token) ? token : null;
  } catch {
    return null; // Private browsing may block storage. In-memory ref still works.
  }
}

export function acquirePendingSaleRequestId(current: string | null): string {
  if (current && UUID_V4.test(current)) return current;
  const token = readPending() ?? crypto.randomUUID();
  // Never store PII or invoice payload in sessionStorage.
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(PENDING_SALE_REQUEST_KEY, token);
    }
  } catch {
    // Keep the in-memory UUID for retry even when storage is unavailable.
  }
  return token;
}

export function clearPendingSaleRequestId(): void {
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(PENDING_SALE_REQUEST_KEY);
    }
  } catch {
    // Clearing an in-memory ref is still required by the caller.
  }
}

/** A refresh may have lost cart state; do not silently discard an unknown sale. */
export function hasUnresolvedSaleRequest(): boolean {
  return readPending() != null;
}

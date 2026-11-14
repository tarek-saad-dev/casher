// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PENDING_SALE_REQUEST_KEY,
  acquirePendingSaleRequestId,
  clearPendingSaleRequestId,
  hasUnresolvedSaleRequest,
} from '@/lib/sales/clientSaleRequestId';

const first = '2ca6be48-092e-4d1e-9e31-98464bd4f991';
const next = '1f6bb5b2-3781-4a08-8f35-07860cb5ea98';

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => first) });
});
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('POS pending invoice UUID across unknown payment response (#246)', () => {
  it('generates one UUID and reuses it for repeated POST in the same tab', () => {
    const id = acquirePendingSaleRequestId(null);
    expect(id).toBe(first);
    expect(sessionStorage.getItem(PENDING_SALE_REQUEST_KEY)).toBe(first);
    expect(acquirePendingSaleRequestId(id)).toBe(first);
    expect(acquirePendingSaleRequestId(null)).toBe(first);
    expect(crypto.randomUUID).toHaveBeenCalledOnce();
    expect(hasUnresolvedSaleRequest()).toBe(true);
  });

  it('recovers the prior POST UUID after component unmount or page reload', () => {
    sessionStorage.setItem(PENDING_SALE_REQUEST_KEY, next);
    expect(acquirePendingSaleRequestId(null)).toBe(next);
    expect(crypto.randomUUID).not.toHaveBeenCalled();
  });

  it('confirmed invoice or explicitly reviewed New Invoice removes pending UUID', () => {
    expect(acquirePendingSaleRequestId(null)).toBe(first);
    clearPendingSaleRequestId();
    expect(hasUnresolvedSaleRequest()).toBe(false);
    expect(sessionStorage.getItem(PENDING_SALE_REQUEST_KEY)).toBeNull();
  });

  it('rejects corrupted/untrusted stored tokens and regenerates valid v4 UUID', () => {
    for (const invalid of ['garbage', '0'.repeat(36), '123e4567-e89b-12d3-a456-426614174000']) {
      sessionStorage.setItem(PENDING_SALE_REQUEST_KEY, invalid);
      expect(hasUnresolvedSaleRequest()).toBe(false);
      expect(acquirePendingSaleRequestId(null)).toBe(first);
      expect(sessionStorage.getItem(PENDING_SALE_REQUEST_KEY)).toBe(first);
    }
  });

  it('never persists customer/payment information in the pending UUID storage', () => {
    acquirePendingSaleRequestId(null);
    const stored = sessionStorage.getItem(PENDING_SALE_REQUEST_KEY);
    expect(stored).toBe(first);
    expect(stored).not.toContain('clientId');
    expect(stored).not.toContain('paymentAllocations');
    expect(stored).not.toContain('customer');
  });
});

/** Phase 7C1 — CORS proxy focused suite. */
import { describe, expect, it } from 'vitest';
import { classifyProxyAuth, isAdminApiPath } from '@/lib/proxyPublicRoutes';

describe('bookingPublicCorsProxy', () => {
  it('keeps /api/public booking anonymous and admin session-required', () => {
    expect(classifyProxyAuth('/api/public/booking/cancel').kind).toBe('anonymous_public');
    expect(classifyProxyAuth('/api/admin/bookings').kind).toBe('session_required');
    expect(isAdminApiPath('/api/admin/x')).toBe(true);
  });
});

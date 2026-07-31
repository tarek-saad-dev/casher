import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { persistQueueTicketSource } from '@/lib/operationsQueueCreateCore';

describe('persistQueueTicketSource', () => {
  it('maps operations_barber_header to ops_header (NVARCHAR(20) safe)', () => {
    expect('operations_barber_header'.length).toBeGreaterThan(20);
    expect(persistQueueTicketSource('operations_barber_header')).toBe('ops_header');
    expect(persistQueueTicketSource('operations_barber_header').length).toBeLessThanOrEqual(20);
  });

  it('keeps short walk_in / booking sources', () => {
    expect(persistQueueTicketSource('walk_in')).toBe('walk_in');
    expect(persistQueueTicketSource('booking')).toBe('booking');
  });
});

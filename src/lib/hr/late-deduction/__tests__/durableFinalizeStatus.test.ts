import { describe, expect, it } from 'vitest';
import { LATE_DEDUCTION_CASE_STATUSES } from '../constants';

describe('durable late-deduction case statuses', () => {
  it('includes finalize_pending for crash-safe handoff', () => {
    expect(LATE_DEDUCTION_CASE_STATUSES).toContain('finalize_pending');
  });

  it('keeps cancelled and applied distinct for recovery filters', () => {
    expect(LATE_DEDUCTION_CASE_STATUSES).toEqual(
      expect.arrayContaining([
        'finalize_pending',
        'applied',
        'pending_manager',
        'cancelled',
      ]),
    );
  });
});

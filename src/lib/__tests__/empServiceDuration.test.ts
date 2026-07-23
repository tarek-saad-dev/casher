import { describe, expect, it } from 'vitest';
import {
  aggregateDurationSource,
  resolveOneServiceDuration,
} from '@/lib/empServiceDuration';

describe('empServiceDuration', () => {
  describe('resolveOneServiceDuration', () => {
    it('prefers emp override over service and system defaults', () => {
      expect(
        resolveOneServiceDuration({
          overrideMinutes: 15,
          serviceDefaultMinutes: 10,
          systemDefaultMinutes: 30,
        }),
      ).toEqual({ durationMinutes: 15, durationSource: 'EMP_SERVICE_OVERRIDE' });
    });

    it('falls back to service default when no override', () => {
      expect(
        resolveOneServiceDuration({
          overrideMinutes: null,
          serviceDefaultMinutes: 10,
          systemDefaultMinutes: 30,
        }),
      ).toEqual({ durationMinutes: 10, durationSource: 'SERVICE_DEFAULT' });
    });

    it('falls back to system default when service default missing', () => {
      expect(
        resolveOneServiceDuration({
          overrideMinutes: null,
          serviceDefaultMinutes: null,
          systemDefaultMinutes: 30,
        }),
      ).toEqual({ durationMinutes: 30, durationSource: 'SYSTEM_DEFAULT' });
    });

    it('ignores non-positive overrides', () => {
      expect(
        resolveOneServiceDuration({
          overrideMinutes: 0,
          serviceDefaultMinutes: 10,
          systemDefaultMinutes: 30,
        }),
      ).toEqual({ durationMinutes: 10, durationSource: 'SERVICE_DEFAULT' });
    });
  });

  describe('aggregateDurationSource', () => {
    it('returns single source when all match', () => {
      expect(
        aggregateDurationSource(['EMP_SERVICE_OVERRIDE', 'EMP_SERVICE_OVERRIDE']),
      ).toBe('EMP_SERVICE_OVERRIDE');
    });

    it('returns MIXED when sources differ', () => {
      expect(
        aggregateDurationSource(['EMP_SERVICE_OVERRIDE', 'SERVICE_DEFAULT']),
      ).toBe('MIXED');
    });

    it('returns EMPTY for no lines', () => {
      expect(aggregateDurationSource([])).toBe('EMPTY');
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  FREELANCE_BOOKING_FALLBACK_END,
  FREELANCE_BOOKING_FALLBACK_START,
  isFreelanceBookingUnlockStatus,
  normalizeFreelanceHhmm,
  resolveFreelanceWorkingWindow,
  shouldUnlockFreelanceForBooking,
} from '@/lib/hr/freelanceBookingUnlock';

describe('freelanceBookingUnlock', () => {
  describe('isFreelanceBookingUnlockStatus', () => {
    it('unlocks Present / Late / EarlyLeave', () => {
      expect(isFreelanceBookingUnlockStatus('Present')).toBe(true);
      expect(isFreelanceBookingUnlockStatus('Late')).toBe(true);
      expect(isFreelanceBookingUnlockStatus('EarlyLeave')).toBe(true);
    });

    it('does not unlock Absent / DayOff / missing', () => {
      expect(isFreelanceBookingUnlockStatus('Absent')).toBe(false);
      expect(isFreelanceBookingUnlockStatus('DayOff')).toBe(false);
      expect(isFreelanceBookingUnlockStatus(null)).toBe(false);
      expect(isFreelanceBookingUnlockStatus(undefined)).toBe(false);
    });
  });

  describe('shouldUnlockFreelanceForBooking', () => {
    it('unlocks freelance with Present attendance', () => {
      expect(
        shouldUnlockFreelanceForBooking({
          employmentType: 'freelance',
          attendanceStatus: 'Present',
        }),
      ).toBe(true);
    });

    it('unlocks attendance-exempt employee with Late', () => {
      expect(
        shouldUnlockFreelanceForBooking({
          employmentType: 'full_time',
          isAttendanceExempt: 1,
          attendanceStatus: 'Late',
        }),
      ).toBe(true);
    });

    it('does not unlock full-time without exemption', () => {
      expect(
        shouldUnlockFreelanceForBooking({
          employmentType: 'full_time',
          isAttendanceExempt: 0,
          attendanceStatus: 'Present',
        }),
      ).toBe(false);
    });

    it('does not unlock freelance without attendance', () => {
      expect(
        shouldUnlockFreelanceForBooking({
          employmentType: 'freelance',
          attendanceStatus: null,
        }),
      ).toBe(false);
    });

    it('does not unlock when explicit day off', () => {
      expect(
        shouldUnlockFreelanceForBooking({
          employmentType: 'freelance',
          attendanceStatus: 'Present',
          hasExplicitDayOff: true,
        }),
      ).toBe(false);
    });
  });

  describe('resolveFreelanceWorkingWindow', () => {
    it('prefers default check-in/out', () => {
      expect(
        resolveFreelanceWorkingWindow({
          defaultStart: '12:00',
          defaultEnd: '00:00',
          checkInTime: '14:30',
          checkOutTime: '22:00',
        }),
      ).toEqual({ start: '12:00', end: '00:00' });
    });

    it('falls back to attendance times then salon defaults', () => {
      expect(
        resolveFreelanceWorkingWindow({
          checkInTime: '13:15',
          checkOutTime: null,
        }),
      ).toEqual({ start: '13:15', end: FREELANCE_BOOKING_FALLBACK_END });

      expect(resolveFreelanceWorkingWindow({})).toEqual({
        start: FREELANCE_BOOKING_FALLBACK_START,
        end: FREELANCE_BOOKING_FALLBACK_END,
      });
    });

    it('replaces identical start/end with salon fallbacks', () => {
      expect(
        resolveFreelanceWorkingWindow({
          defaultStart: '18:00',
          defaultEnd: '18:00',
        }),
      ).toEqual({
        start: FREELANCE_BOOKING_FALLBACK_START,
        end: FREELANCE_BOOKING_FALLBACK_END,
      });
    });
  });

  describe('normalizeFreelanceHhmm', () => {
    it('normalizes HH:MM and HH:MM:SS', () => {
      expect(normalizeFreelanceHhmm('9:05')).toBe('09:05');
      expect(normalizeFreelanceHhmm('14:30:00')).toBe('14:30');
      expect(normalizeFreelanceHhmm('')).toBeNull();
      expect(normalizeFreelanceHhmm(null)).toBeNull();
    });
  });
});

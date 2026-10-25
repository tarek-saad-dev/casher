/**
 * A branch's booking defaults come from its own identity, never from CUT.
 * Existing QueueBookingSettings rows are authoritative and must not be reset.
 * A newly missing row starts with booking OFF until deliberately configured.
 */
import { BOOKING_SETTINGS_DEFAULTS } from './bookingSettingsValidation';

export type BookingBranchIdentity = {
  branchName: string;
  timeZone: string;
};

export function bookingDefaultsForBranch(branch: BookingBranchIdentity) {
  return {
    SalonName: branch.branchName.trim() || 'الفرع الرئيسي',
    Timezone: branch.timeZone.trim() || 'Africa/Cairo',
    Currency: 'EGP',
    BookingEnabled: false,
    AllowSpecificBarber: BOOKING_SETTINGS_DEFAULTS.allowSpecificBarber,
    AllowNearestBarber: BOOKING_SETTINGS_DEFAULTS.allowNearestBarber,
    DefaultMode: BOOKING_SETTINGS_DEFAULTS.defaultMode,
    SlotIntervalMinutes: BOOKING_SETTINGS_DEFAULTS.slotIntervalMinutes,
    MinNoticeMinutes: BOOKING_SETTINGS_DEFAULTS.minNoticeMinutes,
    MaxBookingDaysAhead: BOOKING_SETTINGS_DEFAULTS.maxBookingDaysAhead,
    DefaultServiceDurationMinutes: BOOKING_SETTINGS_DEFAULTS.defaultServiceDurationMinutes,
  };
}

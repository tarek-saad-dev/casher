/** Allowed booking-settings values (QueueBookingSettings). Shared by the settings API and onboarding. */
export const BOOKING_DEFAULT_MODES = ['nearest', 'specific'] as const;
export type BookingDefaultMode = (typeof BOOKING_DEFAULT_MODES)[number];

export const BOOKING_MIN_NOTICE_OPTIONS = [0, 5, 10, 15, 30, 60] as const;
export const BOOKING_SLOT_INTERVAL_OPTIONS = [5, 10, 15, 30] as const;
export const BOOKING_MAX_DAYS_AHEAD_RANGE = { min: 1, max: 60 } as const;
export const BOOKING_DEFAULT_DURATION_RANGE = { min: 5, max: 240 } as const;

/** Runtime defaults of a freshly seeded QueueBookingSettings row. */
export const BOOKING_SETTINGS_DEFAULTS = {
  defaultMode: 'nearest' as BookingDefaultMode,
  slotIntervalMinutes: 15,
  minNoticeMinutes: 30,
  maxBookingDaysAhead: 14,
  defaultServiceDurationMinutes: 30,
  allowSpecificBarber: true,
  allowNearestBarber: true,
};

export type BookingSettingsValues = {
  defaultMode?: unknown;
  slotIntervalMinutes?: unknown;
  minNoticeMinutes?: unknown;
  maxBookingDaysAhead?: unknown;
  defaultServiceDurationMinutes?: unknown;
};

/** First validation error (Arabic, as shown to staff) for the provided values, or null. */
export function bookingSettingsValidationError(values: BookingSettingsValues): string | null {
  if (
    values.minNoticeMinutes !== undefined &&
    !(BOOKING_MIN_NOTICE_OPTIONS as readonly unknown[]).includes(values.minNoticeMinutes)
  ) {
    return 'قيمة MinNoticeMinutes غير صالحة. القيم المسموحة: 0, 5, 10, 15, 30, 60';
  }
  if (
    values.slotIntervalMinutes !== undefined &&
    !(BOOKING_SLOT_INTERVAL_OPTIONS as readonly unknown[]).includes(values.slotIntervalMinutes)
  ) {
    return 'قيمة SlotIntervalMinutes غير صالحة. القيم المسموحة: 5, 10, 15, 30';
  }
  if (
    values.maxBookingDaysAhead !== undefined &&
    (!Number.isInteger(values.maxBookingDaysAhead) ||
      (values.maxBookingDaysAhead as number) < BOOKING_MAX_DAYS_AHEAD_RANGE.min ||
      (values.maxBookingDaysAhead as number) > BOOKING_MAX_DAYS_AHEAD_RANGE.max)
  ) {
    return 'قيمة MaxBookingDaysAhead يجب أن تكون عدد أيام صحيح بين 1 و 60';
  }
  if (
    values.defaultServiceDurationMinutes !== undefined &&
    (!Number.isInteger(values.defaultServiceDurationMinutes) ||
      (values.defaultServiceDurationMinutes as number) < BOOKING_DEFAULT_DURATION_RANGE.min ||
      (values.defaultServiceDurationMinutes as number) > BOOKING_DEFAULT_DURATION_RANGE.max)
  ) {
    return 'مدة الخدمة الافتراضية يجب أن تكون بين 5 و 240 دقيقة';
  }
  if (
    values.defaultMode !== undefined &&
    !(BOOKING_DEFAULT_MODES as readonly unknown[]).includes(values.defaultMode)
  ) {
    return 'قيمة DefaultMode يجب أن تكون nearest أو specific';
  }
  return null;
}

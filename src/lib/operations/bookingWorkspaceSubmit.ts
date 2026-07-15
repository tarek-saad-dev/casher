/**
 * Pure helpers for Operations booking workspace submit lifecycle (Phase 2).
 */

/** Success overlay / close delay — max 200ms; prefer immediate close (0). */
export const BOOKING_SUCCESS_CLOSE_DELAY_MS = 0;

export type BookingCreateSuccess = {
  actualDate: string;
  bookingId?: number;
  code?: string;
};

export function acquireSubmitGuard(submittingRef: { current: boolean }): boolean {
  if (submittingRef.current) return false;
  submittingRef.current = true;
  return true;
}

export function releaseSubmitGuard(submittingRef: { current: boolean }): void {
  submittingRef.current = false;
}

export function parseBookingCreateSuccess(data: unknown): BookingCreateSuccess | null {
  if (!data || typeof data !== 'object') return null;
  const booking = (data as { booking?: Record<string, unknown> }).booking;
  if (!booking || typeof booking !== 'object') return null;
  const actualDate =
    typeof booking.actualDate === 'string'
      ? booking.actualDate
      : typeof booking.date === 'string'
        ? booking.date
        : null;
  if (!actualDate) return null;
  return {
    actualDate,
    bookingId: typeof booking.id === 'number' ? booking.id : undefined,
    code: typeof booking.code === 'string' ? booking.code : undefined,
  };
}

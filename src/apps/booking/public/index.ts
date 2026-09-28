/** DRVO-004 — booking scheduling application boundary. */
export const APP_CODE = 'booking' as const;

export type {
  BookingConversionPort,
  BookingConversionLine,
  BookingSchedulingPorts,
} from './ports';

export { holdBooking, releaseHoldBooking, namespacedHoldKey } from '../application/holdBooking';
export { createBooking } from '../application/createBooking';
export { cancelBooking } from '../application/cancelBooking';
export {
  reschedulePublicBookingCommand,
  rescheduleOpsBooking,
} from '../application/rescheduleBooking';
export { convertBooking } from '../application/convertBooking';
export type { ConvertBookingInput, ConvertBookingResult } from '../application/convertBooking';
export { isBookingSchedulingPortEnabled } from '../internal/schedulingPortFlag';

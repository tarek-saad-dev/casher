'use client';

/**
 * Shared Ops service picker — same Phase B BookingServiceSelect experience.
 * Queue and Booking keep separate domain mutations; only presentation is shared.
 */
export {
  BookingServiceSelect as OpsServicePicker,
  type BookingSelectService as OpsServicePickerService,
} from './BookingServiceSelect';

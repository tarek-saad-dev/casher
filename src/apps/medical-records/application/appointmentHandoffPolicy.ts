export type ClinicAppointmentStatus = 'pending' | 'confirmed' | 'arrived' | 'queued' | 'in_service' | string;

export type ClinicAppointmentAction = 'arrive' | 'start';

export function parseClinicBookingId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id <= 2147483647 ? id : null;
}

export function isClinicCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Reception check-in never revives a cancelled, rescheduled, or no-show booking. */
export function isClinicArrivalAllowed(status: string): boolean {
  return status === 'pending' || status === 'confirmed';
}

export function isClinicStartAllowed(status: string): boolean {
  return status === 'arrived' || status === 'queued';
}

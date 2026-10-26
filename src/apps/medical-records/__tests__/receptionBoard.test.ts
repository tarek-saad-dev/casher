import { describe, expect, it } from 'vitest';
import {
  filterReceptionAppointments, receptionBucket, receptionSummary,
  type ReceptionAppointment,
} from '../application/receptionBoard';

const appt = (changes: Partial<ReceptionAppointment>): ReceptionAppointment => ({
  BookingID: 1,
  BookingDate: '2026-10-26',
  StartTimeDisplay: '18:00',
  Status: 'confirmed',
  ClientID: 8,
  PatientName: 'أحمد علي',
  PractitionerEmpID: 12,
  PractitionerName: 'محمد',
  EncounterId: null,
  EncounterStatus: null,
  ...changes,
});

const bookings = [
  appt({ BookingID: 1 }),
  appt({ BookingID: 2, PatientName: 'فاطمة', PractitionerEmpID: 16, PractitionerName: 'منى', Status: 'arrived' }),
  appt({ BookingID: 3, Status: 'queued' }),
  appt({ BookingID: 4, Status: 'in_service', EncounterId: 'encounter-4', EncounterStatus: 'in_progress' }),
  appt({ BookingID: 5, Status: 'in_service', EncounterId: 'encounter-5', EncounterStatus: 'completed' }),
  appt({ BookingID: 6, Status: 'cancelled' }),
  appt({ BookingID: 7, Status: 'no_show' }),
  appt({ BookingID: 8, Status: 'completed' }),
];

describe('clinic reception projection of Shared Booking', () => {
  it('maps canonical statuses into operational groups without writing a second appointment model', () => {
    expect(receptionSummary(bookings)).toEqual({
      all: 8,
      upcoming: 1,
      waiting: 2,
      in_service: 1,
      completed: 2,
      exceptions: 2,
    });
  });

  it('uses encounter completion even if the canonical booking status is still in_service', () => {
    expect(receptionBucket(appt({
      Status: 'in_service',
      EncounterStatus: 'completed',
      EncounterId: 'encounter',
    }))).toBe('completed');
  });

  it('filters by doctor and waiting state without leaking other doctors into the list', () => {
    expect(filterReceptionAppointments(bookings, {
      bucket: 'waiting', doctorId: '16', search: '',
    }).map(x => x.BookingID)).toEqual([2]);
  });

  it('searches patient, doctor and booking ID regardless of selected doctor when doctor=all', () => {
    expect(filterReceptionAppointments(bookings, {
      bucket: 'all', doctorId: 'all', search: 'فاطمة',
    }).map(x => x.BookingID)).toEqual([2]);
    expect(filterReceptionAppointments(bookings, {
      bucket: 'all', doctorId: 'all', search: 'منى',
    }).map(x => x.BookingID)).toEqual([2]);
    expect(filterReceptionAppointments(bookings, {
      bucket: 'all', doctorId: 'all', search: '7',
    }).map(x => x.BookingID)).toEqual([7]);
  });

  it('does not mistake cancelled, rescheduled, no-show or unknown statuses for waiting patients', () => {
    for (const status of ['cancelled', 'rescheduled', 'no_show', 'unexpected']) {
      expect(receptionBucket(appt({ Status: status }))).toBe('exceptions');
    }
  });

  it('does not mutate source appointment objects or their order when filtering', () => {
    const copy = bookings.slice();
    filterReceptionAppointments(bookings, { bucket: 'completed', doctorId: 'all', search: '' });
    expect(bookings).toEqual(copy);
  });
});

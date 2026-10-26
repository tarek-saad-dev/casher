/** View-only projection over Shared Booking: zero duplicated appointments/state. */
export type ReceptionBucket =
  | 'all'
  | 'upcoming'
  | 'waiting'
  | 'in_service'
  | 'completed'
  | 'exceptions';

export type ReceptionAppointment = {
  BookingID: number;
  BookingDate: string | Date;
  StartTimeDisplay: string | null;
  Status: string;
  ClientID: number;
  PatientName: string;
  PractitionerEmpID: number;
  PractitionerName: string;
  EncounterId: string | null;
  EncounterStatus: string | null;
};

export function receptionBucket(item: Pick<ReceptionAppointment, 'Status' | 'EncounterId' | 'EncounterStatus'>): Exclude<ReceptionBucket, 'all'> {
  if (item.EncounterStatus === 'completed' || item.Status === 'completed') return 'completed';
  if (item.EncounterId || item.Status === 'in_service') return 'in_service';
  if (item.Status === 'arrived' || item.Status === 'queued') return 'waiting';
  if (item.Status === 'pending' || item.Status === 'confirmed') return 'upcoming';
  return 'exceptions';
}

export function receptionSummary(items: ReceptionAppointment[]) {
  const counts = { all: items.length, upcoming: 0, waiting: 0, in_service: 0, completed: 0, exceptions: 0 };
  for (const item of items) counts[receptionBucket(item)] += 1;
  return counts;
}

export function filterReceptionAppointments(
  items: ReceptionAppointment[],
  filter: { bucket: ReceptionBucket; doctorId: string; search: string },
): ReceptionAppointment[] {
  const q = filter.search.trim().toLocaleLowerCase();
  return items.filter(item => {
    if (filter.bucket !== 'all' && receptionBucket(item) !== filter.bucket) return false;
    if (filter.doctorId !== 'all' && String(item.PractitionerEmpID) !== filter.doctorId) return false;
    if (!q) return true;
    return (
      item.PatientName.toLocaleLowerCase().includes(q)
      || item.PractitionerName.toLocaleLowerCase().includes(q)
      || String(item.BookingID).includes(q)
    );
  });
}

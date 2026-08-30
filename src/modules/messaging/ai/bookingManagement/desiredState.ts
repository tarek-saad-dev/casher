import type { DesiredBookingChanges, UpcomingBookingSummary } from './types';

export type DesiredBookingState = {
  bookingCode: string;
  bookingId: number | null;
  workDate: string | null;
  time: string | null;
  empId: number | null;
  employeeName: string | null;
  branchCode: string | null;
  branchName: string | null;
  serviceIds: number[] | null;
  servicesSummary: string | null;
};

/** Apply only requested deltas onto the committed snapshot. */
export function buildDesiredBookingState(
  original: UpcomingBookingSummary,
  changes: DesiredBookingChanges,
): DesiredBookingState {
  return {
    bookingCode: original.bookingCode,
    bookingId: original.bookingId,
    workDate: changes.date !== undefined ? changes.date : original.workDate,
    time: changes.time !== undefined ? changes.time : original.time,
    empId: changes.empId !== undefined ? changes.empId : original.empId,
    employeeName:
      changes.employeeName !== undefined ? changes.employeeName : original.employeeName,
    branchCode: changes.branchCode !== undefined ? changes.branchCode : original.branchCode,
    branchName: original.branchName,
    serviceIds: changes.serviceIds !== undefined ? changes.serviceIds : null,
    servicesSummary: original.servicesSummary,
  };
}

export function fingerprintDesiredState(state: DesiredBookingState): string {
  return [
    state.bookingCode,
    state.workDate ?? '',
    state.time ?? '',
    state.empId ?? '',
    state.branchCode ?? '',
    (state.serviceIds ?? []).join(','),
  ].join('|');
}

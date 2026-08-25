/**
 * Phase A: facades must be the same functions as current lib implementations.
 * Fails if someone wraps/reimplements by accident.
 */
import { describe, expect, it } from 'vitest';

import * as AttendanceLib from '@/lib/hr/attendance/branchAttendance.service';
import * as AttendanceMod from '@/modules/attendance';

import * as BusinessDateLib from '@/lib/businessDate';
import * as BusinessDayLib from '@/lib/branch/businessDay';
import * as BusinessDayMod from '@/modules/business-day';

import * as TransferLib from '@/lib/hr/temporaryBranchTransfer';
import * as TransferMod from '@/modules/transfers';

import * as AvailabilityLib from '@/lib/booking/AvailabilityMutationNotifier';
import * as AvailabilityMod from '@/modules/availability';

describe('Phase A workforce module facades', () => {
  it('attendance public API is identity re-export', () => {
    expect(AttendanceMod.checkInEmployee).toBe(AttendanceLib.checkInEmployee);
    expect(AttendanceMod.checkOutEmployee).toBe(AttendanceLib.checkOutEmployee);
    expect(AttendanceMod.getOpenAttendanceForEmployee).toBe(
      AttendanceLib.getOpenAttendanceForEmployee,
    );
    expect(AttendanceMod.resolveAttendanceWorkDate).toBe(
      AttendanceLib.resolveAttendanceWorkDate,
    );
    expect(AttendanceMod.AttendanceDomainError).toBe(
      AttendanceLib.AttendanceDomainError,
    );
  });

  it('business-day public API is identity re-export (clock + TblNewDay stay distinct)', () => {
    expect(BusinessDayMod.getOperationalDate).toBe(BusinessDateLib.getOperationalDate);
    expect(BusinessDayMod.getCairoBusinessDate).toBe(
      BusinessDateLib.getCairoBusinessDate,
    );
    expect(BusinessDayMod.getBranchBusinessDate).toBe(
      BusinessDayLib.getBranchBusinessDate,
    );
    expect(BusinessDayMod.getOpenBusinessDay).toBe(BusinessDayLib.getOpenBusinessDay);
  });

  it('transfers public API is identity re-export', () => {
    expect(TransferMod.previewTemporaryBranchTransfer).toBe(
      TransferLib.previewTemporaryBranchTransfer,
    );
    expect(TransferMod.createTemporaryBranchTransfer).toBe(
      TransferLib.createTemporaryBranchTransfer,
    );
    expect(TransferMod.cancelTemporaryBranchTransfer).toBe(
      TransferLib.cancelTemporaryBranchTransfer,
    );
  });

  it('availability public API is identity re-export', () => {
    expect(AvailabilityMod.AvailabilityMutationNotifier).toBe(
      AvailabilityLib.AvailabilityMutationNotifier,
    );
  });
});

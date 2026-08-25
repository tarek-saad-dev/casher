import { describe, expect, it } from 'vitest';
import * as BusinessDayLib from '@/lib/branch/businessDay';
import * as ShiftLib from '@/lib/branch/shiftSession';
import * as BusinessDaySvc from '@/modules/operations/application/BusinessDayService';
import * as ShiftSvc from '@/modules/operations/application/ShiftSessionService';

describe('Phase 1A service facades are identity re-exports', () => {
  it('BusinessDayService delegates to lib/branch/businessDay without wrapping', () => {
    expect(BusinessDaySvc.openBusinessDay).toBe(BusinessDayLib.openBusinessDay);
    expect(BusinessDaySvc.closeBusinessDay).toBe(BusinessDayLib.closeBusinessDay);
    expect(BusinessDaySvc.getOpenBusinessDay).toBe(BusinessDayLib.getOpenBusinessDay);
    expect(BusinessDaySvc.getBranchBusinessDate).toBe(BusinessDayLib.getBranchBusinessDate);
    expect(BusinessDaySvc.BusinessDayService.open).toBe(BusinessDayLib.openBusinessDay);
  });

  it('ShiftSessionService delegates to lib/branch/shiftSession without wrapping', () => {
    expect(ShiftSvc.openShift).toBe(ShiftLib.openShift);
    expect(ShiftSvc.closeShift).toBe(ShiftLib.closeShift);
    expect(ShiftSvc.handoffShift).toBe(ShiftLib.handoffShift);
    expect(ShiftSvc.getUserOpenShift).toBe(ShiftLib.getUserOpenShift);
    expect(ShiftSvc.getUserOpenShiftForBranch).toBe(ShiftLib.getUserOpenShiftForBranch);
    expect(ShiftSvc.ShiftSessionService.open).toBe(ShiftLib.openShift);
    expect(ShiftSvc.ShiftSessionService.handoff).toBe(ShiftLib.handoffShift);
  });
});

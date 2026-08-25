/**
 * Application API for shift-session mutations and reads.
 * Writes run through openShiftSession / closeShiftSession / handoffShiftSession.
 * This facade re-exports the lib/branch/shiftSession entry points so existing
 * imports and Phase 1A identity tests stay stable.
 */
import 'server-only';
import * as impl from '@/lib/branch/shiftSession';

export {
  closeOwnOpenShift,
  closeShift,
  getUserOpenShift,
  getUserOpenShiftForBranch,
  handoffShift,
  listOpenShiftsForBranch,
  openShift,
  validateShiftBelongsToBranch,
  type ShiftMoveRecord,
} from '@/lib/branch/shiftSession';

export const ShiftSessionService = {
  get open() {
    return impl.openShift;
  },
  get close() {
    return impl.closeShift;
  },
  get closeOwn() {
    return impl.closeOwnOpenShift;
  },
  get handoff() {
    return impl.handoffShift;
  },
  get getUserOpen() {
    return impl.getUserOpenShift;
  },
  get getUserOpenForBranch() {
    return impl.getUserOpenShiftForBranch;
  },
  get listOpenForBranch() {
    return impl.listOpenShiftsForBranch;
  },
  get validateBelongsToBranch() {
    return impl.validateShiftBelongsToBranch;
  },
};

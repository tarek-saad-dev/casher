/**
 * Application API for business-day mutations and reads.
 * Writes run through open/close/closeAndOpen application commands.
 * This facade re-exports the lib/branch/businessDay entry points so existing
 * imports and Phase 1A identity tests stay stable.
 */
import 'server-only';
import * as impl from '@/lib/branch/businessDay';

export {
  closeAndOpenBusinessDay,
  closeBusinessDay,
  forceCloseBranchShifts,
  getBranchBusinessDate,
  getBusinessDayByDate,
  getBusinessDayById,
  getOpenBusinessDay,
  listOpenShiftsForBranchDay,
  openBusinessDay,
  validateBusinessDayBelongsToBranch,
  type BusinessDayRecord,
} from '@/lib/branch/businessDay';

export const BusinessDayService = {
  get open() {
    return impl.openBusinessDay;
  },
  get close() {
    return impl.closeBusinessDay;
  },
  get closeAndOpen() {
    return impl.closeAndOpenBusinessDay;
  },
  get forceCloseShifts() {
    return impl.forceCloseBranchShifts;
  },
  get getOpen() {
    return impl.getOpenBusinessDay;
  },
  get getById() {
    return impl.getBusinessDayById;
  },
  get getByDate() {
    return impl.getBusinessDayByDate;
  },
  get getBusinessDate() {
    return impl.getBranchBusinessDate;
  },
  get listOpenShifts() {
    return impl.listOpenShiftsForBranchDay;
  },
  get validateBelongsToBranch() {
    return impl.validateBusinessDayBelongsToBranch;
  },
};

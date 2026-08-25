/**
 * BusinessDay module public API (Phase A facade).
 *
 * Two existing clocks are re-exported as-is — they are NOT unified:
 * - getOperationalDate / getCairoBusinessDate  → src/lib/businessDate.ts (04:00 cutoff)
 * - getBranchBusinessDate / getOpenBusinessDay → src/lib/branch/businessDay.ts (TblNewDay + branch cutoff)
 *
 * Importing this barrel pulls TblNewDay helpers (server-only).
 * Client UI should keep using @/lib/businessDate until a client entry exists.
 */
import 'server-only';

export {
  BUSINESS_DAY_CUTOFF_HOUR,
  SALON_TZ,
  getCairoBusinessDate,
  getCairoCalendarDate,
  getOperationalDate,
  type OperationalDateOptions,
} from './clock';

export {
  getBranchBusinessDate,
  getBusinessDayByDate,
  getBusinessDayById,
  getOpenBusinessDay,
  type BusinessDayRecord,
} from './infra/tblNewDay';

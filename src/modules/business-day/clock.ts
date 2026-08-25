/**
 * Clock / cutoff helpers. Same semantics as src/lib/businessDate.ts.
 * Safe for client and server. Do not change cutoff here.
 */
export {
  BUSINESS_DAY_CUTOFF_HOUR,
  SALON_TZ,
  getCairoBusinessDate,
  getCairoCalendarDate,
  getOperationalDate,
  type OperationalDateOptions,
} from '@/lib/businessDate';

/**
 * TblNewDay persistence. Same semantics as src/lib/branch/businessDay.ts.
 * Server-only. Do not unify with clock cutoff in Phase A.
 */
export {
  getBranchBusinessDate,
  getBusinessDayByDate,
  getBusinessDayById,
  getOpenBusinessDay,
  type BusinessDayRecord,
} from '@/lib/branch/businessDay';

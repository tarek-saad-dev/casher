/**
 * Grandfathered paths allowed to SQL-write operational calendar tables directly.
 * New code outside this list must go through Operational Calendar public API.
 */
export const CALENDAR_TABLE_WRITER_ALLOWLIST = [
  'src/modules/operations/infra/businessDayMutationTx.ts',
  'src/modules/operations/infra/shiftMutationTx.ts',
  'src/modules/operations/infra/businessDayLock.ts',
  'src/modules/operations/infra/operationalBootstrapRepository.ts',
  'src/lib/branch/businessDay.ts',
  'src/shared/operational-calendar/internal/transactionReads.ts',
] as const;

export const CALENDAR_FORBIDDEN_TABLES = [
  'TblNewDay',
  'TblShift',
  'TblShiftMove',
] as const;

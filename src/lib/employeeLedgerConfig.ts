/**
 * Employee Ledger dual-write feature flag (Phase 2+).
 * Default: disabled unless EMP_LEDGER_DUAL_WRITE_ENABLED=true
 */
export function isEmployeeLedgerDualWriteEnabled(): boolean {
  return process.env.EMP_LEDGER_DUAL_WRITE_ENABLED === 'true';
}

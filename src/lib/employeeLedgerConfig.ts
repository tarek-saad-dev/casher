/**
 * Employee Ledger dual-write feature flag (Phase 2+).
 * Default: disabled unless EMP_LEDGER_DUAL_WRITE_ENABLED is a truthy flag value.
 */
export function isEmployeeLedgerDualWriteEnabled(): boolean {
  const raw = process.env.EMP_LEDGER_DUAL_WRITE_ENABLED?.trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

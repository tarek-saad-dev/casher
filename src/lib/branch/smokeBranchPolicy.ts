/**
 * Shared allowlist for controlled smoke branches.
 * Never includes GLEEM. Never auto-activates a branch.
 */
export const GLEEM_BRANCH_CODE = 'GLEEM';

/** Legacy technical smoke branch (Phase 1G–1M). */
export const LEGACY_SMOKE_BRANCH_CODE = 'PH1GTEST';

/** Real second branch — technical smoke only while SETUP/SMOKE_TEST. */
export const CAMP_CAESAR_BRANCH_CODE = 'CAMP_CAESAR';

export const ALLOWED_SMOKE_BRANCH_CODES = [
  LEGACY_SMOKE_BRANCH_CODE,
  CAMP_CAESAR_BRANCH_CODE,
] as const;

export type AllowedSmokeBranchCode = (typeof ALLOWED_SMOKE_BRANCH_CODES)[number];

/** @deprecated Prefer ALLOWED_SMOKE_BRANCH_CODES — kept for older test assertions. */
export const SMOKE_BRANCH_CODE = LEGACY_SMOKE_BRANCH_CODE;

export function isAllowedSmokeBranchCode(code: string): code is AllowedSmokeBranchCode {
  return (ALLOWED_SMOKE_BRANCH_CODES as readonly string[]).includes(code);
}

/** Proof keys required in ResultJson of a PASSED smoke run for INTERNAL_LIVE. */
export const INTERNAL_LIVE_SMOKE_PROOF_KEYS = [
  'inventory.adjustment',
  'inventory.consumption',
  'pos.cashInvoice',
  'pos.cardInvoice',
  'payroll.hourlyLedgerCredit',
  'payroll.monthlySalaryPost',
  'target.positiveEntitlement',
  'target.ledgerCredit',
  'advance.payout',
  'gleem.isolation',
  'cleanup.completed',
] as const;

export type InternalLiveSmokeProofKey = (typeof INTERNAL_LIVE_SMOKE_PROOF_KEYS)[number];

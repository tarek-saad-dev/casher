/**
 * Phase 4C — Legacy daily payroll post-to-cash feature flags.
 */

import { isEmployeeLedgerDualWriteEnabled } from '@/lib/employeeLedgerConfig';

export { isEmployeeLedgerDualWriteEnabled };

export const LEGACY_POST_TO_CASH_DISABLED_MESSAGE =
  'تم إيقاف ترحيل اليوميات القديم. استخدم دفتر الموظفين لصرف المستحقات.';

export const LEGACY_POST_TO_CASH_WARNING =
  'تحذير: هذا الترحيل قد يضخم الإيرادات والمصروفات. النظام الجديد يفضل صرف المستحقات من دفتر الموظفين.';

export const LEGACY_POST_TO_CASH_REDIRECT_TAB = 'employee-ledger';

export function isLegacyPostToCashDisabled(): boolean {
  return process.env.EMP_LEDGER_DISABLE_LEGACY_POST_TO_CASH === 'true';
}

export function shouldBlockLegacyPostToCash(): boolean {
  return isEmployeeLedgerDualWriteEnabled() && isLegacyPostToCashDisabled();
}

export function getLegacyPostToCashWarning(): string | null {
  if (isEmployeeLedgerDualWriteEnabled() && !isLegacyPostToCashDisabled()) {
    return LEGACY_POST_TO_CASH_WARNING;
  }
  return null;
}

export function getLegacyPostToCashConfig() {
  const dualWriteEnabled = isEmployeeLedgerDualWriteEnabled();
  const legacyPostToCashDisabled = shouldBlockLegacyPostToCash();
  return {
    ledgerDualWriteEnabled: dualWriteEnabled,
    legacyPostToCashDisabled,
    legacyPostToCashWarning: getLegacyPostToCashWarning(),
    redirectTab: LEGACY_POST_TO_CASH_REDIRECT_TAB,
  };
}

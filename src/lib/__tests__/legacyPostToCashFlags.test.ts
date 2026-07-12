import { describe, it, expect, afterEach } from 'vitest';
import {
  getLegacyPostToCashConfig,
  getLegacyPostToCashWarning,
  isLegacyPostToCashDisabled,
  shouldBlockLegacyPostToCash,
} from '@/lib/payroll/legacyPostToCashFlags';

const ORIG_DUAL = process.env.EMP_LEDGER_DUAL_WRITE_ENABLED;
const ORIG_DISABLE = process.env.EMP_LEDGER_DISABLE_LEGACY_POST_TO_CASH;

afterEach(() => {
  if (ORIG_DUAL === undefined) delete process.env.EMP_LEDGER_DUAL_WRITE_ENABLED;
  else process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = ORIG_DUAL;
  if (ORIG_DISABLE === undefined) delete process.env.EMP_LEDGER_DISABLE_LEGACY_POST_TO_CASH;
  else process.env.EMP_LEDGER_DISABLE_LEGACY_POST_TO_CASH = ORIG_DISABLE;
});

describe('legacyPostToCashFlags', () => {
  it('blocks only when both flags are true', () => {
    delete process.env.EMP_LEDGER_DUAL_WRITE_ENABLED;
    delete process.env.EMP_LEDGER_DISABLE_LEGACY_POST_TO_CASH;
    expect(shouldBlockLegacyPostToCash()).toBe(false);

    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    expect(shouldBlockLegacyPostToCash()).toBe(false);

    process.env.EMP_LEDGER_DISABLE_LEGACY_POST_TO_CASH = 'true';
    expect(shouldBlockLegacyPostToCash()).toBe(true);
  });

  it('isLegacyPostToCashDisabled reads disable flag only', () => {
    delete process.env.EMP_LEDGER_DISABLE_LEGACY_POST_TO_CASH;
    expect(isLegacyPostToCashDisabled()).toBe(false);
    process.env.EMP_LEDGER_DISABLE_LEGACY_POST_TO_CASH = 'true';
    expect(isLegacyPostToCashDisabled()).toBe(true);
  });

  it('returns warning when dual-write on and legacy not disabled', () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    delete process.env.EMP_LEDGER_DISABLE_LEGACY_POST_TO_CASH;
    expect(getLegacyPostToCashWarning()).toContain('تحذير');

    process.env.EMP_LEDGER_DISABLE_LEGACY_POST_TO_CASH = 'true';
    expect(getLegacyPostToCashWarning()).toBeNull();
  });

  it('getLegacyPostToCashConfig exposes frontend fields', () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    process.env.EMP_LEDGER_DISABLE_LEGACY_POST_TO_CASH = 'true';
    const cfg = getLegacyPostToCashConfig();
    expect(cfg.ledgerDualWriteEnabled).toBe(true);
    expect(cfg.legacyPostToCashDisabled).toBe(true);
    expect(cfg.redirectTab).toBe('employee-ledger');
  });
});

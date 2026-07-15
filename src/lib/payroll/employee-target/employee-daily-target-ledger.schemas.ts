import { assertValidWorkDate, EmployeeTargetValidationError } from './target.validation';

export type TargetLedgerSyncAction =
  | 'inserted'
  | 'updated'
  | 'deleted'
  | 'noop'
  | 'unchanged';

export type TargetLedgerReconcileStatus =
  | 'matched'
  | 'missing_ledger_entry'
  | 'amount_mismatch'
  | 'employee_mismatch'
  | 'date_mismatch'
  | 'payroll_month_mismatch'
  | 'wrong_direction'
  | 'wrong_reason'
  | 'duplicate_ledger_entries'
  | 'extra_ledger_entry_for_zero_target'
  | 'orphan_target_ledger_entry';

export interface TargetLedgerSyncBody {
  workDate?: string;
  year?: number;
  month?: number;
  empIds?: number[] | null;
  dryRun: boolean;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseOptionalEmpIds(raw: unknown): number[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) {
    throw new EmployeeTargetValidationError('empIds يجب أن يكون مصفوفة أرقام');
  }
  const ids = raw.map((x) => Number(x)).filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) {
    throw new EmployeeTargetValidationError('empIds غير صالحة');
  }
  return [...new Set(ids)];
}

/**
 * Default dryRun = true.
 * Requires either workDate OR year+month. Unlimited all-history is rejected.
 */
export function parseTargetLedgerSyncBody(body: unknown): TargetLedgerSyncBody {
  if (!isPlainObject(body)) {
    throw new EmployeeTargetValidationError('بيانات غير صالحة');
  }

  const dryRun = body.dryRun === undefined ? true : Boolean(body.dryRun);
  const empIds = parseOptionalEmpIds(body.empIds);

  const hasWorkDate = body.workDate != null && String(body.workDate).trim() !== '';
  const hasYear = body.year != null;
  const hasMonth = body.month != null;

  if (hasWorkDate) {
    const workDate = String(body.workDate).slice(0, 10);
    assertValidWorkDate(workDate);
    if (hasYear || hasMonth) {
      throw new EmployeeTargetValidationError('حدد workDate أو year+month وليس الاثنين معًا');
    }
    return { workDate, empIds, dryRun };
  }

  if (hasYear || hasMonth) {
    const year = Number(body.year);
    const month = Number(body.month);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new EmployeeTargetValidationError('year غير صالح');
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new EmployeeTargetValidationError('month غير صالح');
    }
    return { year, month, empIds, dryRun };
  }

  throw new EmployeeTargetValidationError(
    'يجب تحديد نطاق: workDate أو year+month — النطاق غير المحدود مرفوض',
  );
}

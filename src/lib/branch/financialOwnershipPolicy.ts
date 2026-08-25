/**
 * Phase 5 — one financial ownership policy.
 *
 * Operational writes stamp:
 *   BranchID + BusinessDayID + ShiftMoveID (when SHIFT-scoped)
 *
 * Clients are never authoritative for those three fields.
 * ViewBranch never owns SHIFT writes (OperationalBranch comes from OPEN ShiftSession).
 */

import { NextResponse } from 'next/server';

export type FinancialCommandScope = 'BRANCH' | 'DAY' | 'SHIFT' | 'HISTORICAL';

export type FinancialCommand =
  | 'sale.create'
  | 'sale.mutate'
  | 'service_payment.create'
  | 'expense.create'
  | 'expense.mutate'
  | 'income.create'
  | 'income.mutate'
  | 'deduction.create'
  | 'treasury.transfer.current'
  | 'treasury.transfer.historical'
  | 'purchase.create'
  | 'purchase.mutate'
  | 'booking.convert'
  | 'payroll.cash_post'
  | 'pos.tip'
  | 'expense.past_date'
  | 'income.past_date'
  | 'ledger.payout'
  | 'ledger.funding';

export type FinancialOwnershipRecord = {
  scope: FinancialCommandScope;
  branchId: number;
  businessDayId: number | null;
  businessDate: string | null;
  shiftMoveId: number | null;
};

export type HistoricalFinancialContext = {
  scope: 'HISTORICAL';
  branchId: number;
  businessDayId: number;
  businessDate: string;
  shiftMoveId: null;
};

export type FinancialCommandPolicy = {
  scope: FinancialCommandScope;
  /** Current-day SHIFT commands fail closed without an OPEN ShiftSession. */
  requiresOpenShift: boolean;
  /**
   * Purchases: SHIFT when an OPEN shift exists, otherwise DAY on the
   * authorized selected branch + current BusinessDay (existing behavior).
   */
  allowDayFallback: boolean;
  notes: string;
};

/**
 * Purchase policy (existing behavior, made explicit):
 *
 *   SHIFT when the user has an OPEN ShiftSession → operational branch + that
 *   shift's BusinessDay + ShiftMoveID.
 *   DAY otherwise → authorized selected branch + current OPEN BusinessDay,
 *   ShiftMoveID null.
 *
 * Purchases belong to the open operational day, so BusinessDayID is always
 * stamped on create. They are not HISTORICAL.
 */
export const PURCHASE_OWNERSHIP_POLICY: FinancialCommandPolicy = {
  scope: 'SHIFT',
  requiresOpenShift: false,
  allowDayFallback: true,
  notes:
    'SHIFT if OPEN ShiftSession exists (operational branch); else DAY on authorized selected branch + open BusinessDay. Always stamp BusinessDayID.',
};

export const FINANCIAL_OWNERSHIP_MATRIX: Record<FinancialCommand, FinancialCommandPolicy> = {
  'sale.create': {
    scope: 'SHIFT',
    requiresOpenShift: true,
    allowDayFallback: false,
    notes: 'POS sale + service payments inherit invoice SHIFT ownership',
  },
  'sale.mutate': {
    scope: 'SHIFT',
    requiresOpenShift: false,
    allowDayFallback: false,
    notes: 'Load stored invoice ownership; do not re-derive from ViewBranch',
  },
  'service_payment.create': {
    scope: 'SHIFT',
    requiresOpenShift: true,
    allowDayFallback: false,
    notes: 'Child of sale.create — TblinvServPayment inherits invoice Branch/Day/Shift',
  },
  'expense.create': {
    scope: 'SHIFT',
    requiresOpenShift: true,
    allowDayFallback: false,
    notes: 'Current-day expense on OPEN shift',
  },
  'expense.mutate': {
    scope: 'SHIFT',
    requiresOpenShift: false,
    allowDayFallback: false,
    notes: 'Load stored cash-move ownership',
  },
  'income.create': {
    scope: 'SHIFT',
    requiresOpenShift: true,
    allowDayFallback: false,
    notes: 'Current-day income on OPEN shift; invDate from BusinessDay',
  },
  'income.mutate': {
    scope: 'SHIFT',
    requiresOpenShift: false,
    allowDayFallback: false,
    notes: 'Load stored cash-move ownership; ignore client ShiftMoveID',
  },
  'deduction.create': {
    scope: 'SHIFT',
    requiresOpenShift: true,
    allowDayFallback: false,
    notes: 'Current-day payroll deduction on OPEN shift',
  },
  'treasury.transfer.current': {
    scope: 'SHIFT',
    requiresOpenShift: true,
    allowDayFallback: false,
    notes: 'Same-day treasury transfer on OPEN shift',
  },
  'treasury.transfer.historical': {
    scope: 'HISTORICAL',
    requiresOpenShift: false,
    allowDayFallback: false,
    notes: 'transferDate → HistoricalFinancialContext; ShiftMoveID always null',
  },
  'purchase.create': PURCHASE_OWNERSHIP_POLICY,
  'purchase.mutate': {
    scope: 'SHIFT',
    requiresOpenShift: false,
    allowDayFallback: true,
    notes: 'Load stored purchase ownership',
  },
  'booking.convert': {
    scope: 'SHIFT',
    requiresOpenShift: true,
    allowDayFallback: false,
    notes: 'Booking → invoice uses OPEN shift, not booking date or ViewBranch',
  },
  'payroll.cash_post': {
    scope: 'HISTORICAL',
    requiresOpenShift: false,
    allowDayFallback: false,
    notes: 'workDate → historical BusinessDay; never current ShiftMoveID',
  },
  'pos.tip': {
    scope: 'SHIFT',
    requiresOpenShift: true,
    allowDayFallback: false,
    notes: 'POS tip cash-in on OPEN shift',
  },
  'expense.past_date': {
    scope: 'HISTORICAL',
    requiresOpenShift: false,
    allowDayFallback: false,
    notes: 'Past-date expense; ShiftMoveID null',
  },
  'income.past_date': {
    scope: 'HISTORICAL',
    requiresOpenShift: false,
    allowDayFallback: false,
    notes: 'Past-date income; ShiftMoveID null',
  },
  'ledger.payout': {
    scope: 'HISTORICAL',
    requiresOpenShift: false,
    allowDayFallback: false,
    notes: 'Employee ledger payout on requested payoutDate',
  },
  'ledger.funding': {
    scope: 'HISTORICAL',
    requiresOpenShift: false,
    allowDayFallback: false,
    notes: 'Employee ledger funding on requested date',
  },
};

export function getFinancialCommandPolicy(command: FinancialCommand): FinancialCommandPolicy {
  return FINANCIAL_OWNERSHIP_MATRIX[command];
}

export const CLIENT_OWNERSHIP_FIELD_KEYS = [
  'BranchID',
  'branchId',
  'BusinessDayID',
  'businessDayId',
  'ShiftMoveID',
  'shiftMoveId',
  'shiftMoveID',
] as const;

function readClientOwnershipField(
  body: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(body, key) && body[key] != null && body[key] !== '') {
      return body[key];
    }
  }
  return undefined;
}

export function hasClientOwnershipFields(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const rec = body as Record<string, unknown>;
  return CLIENT_OWNERSHIP_FIELD_KEYS.some(
    (key) => Object.prototype.hasOwnProperty.call(rec, key) && rec[key] != null && rec[key] !== '',
  );
}

export function readClientOwnershipFields(body: unknown): {
  branchId?: number;
  businessDayId?: number;
  shiftMoveId?: number;
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const rec = body as Record<string, unknown>;
  const branchRaw = readClientOwnershipField(rec, ['BranchID', 'branchId']);
  const dayRaw = readClientOwnershipField(rec, ['BusinessDayID', 'businessDayId']);
  const shiftRaw = readClientOwnershipField(rec, ['ShiftMoveID', 'shiftMoveId', 'shiftMoveID']);
  const out: { branchId?: number; businessDayId?: number; shiftMoveId?: number } = {};
  if (branchRaw != null && Number.isFinite(Number(branchRaw))) out.branchId = Number(branchRaw);
  if (dayRaw != null && Number.isFinite(Number(dayRaw))) out.businessDayId = Number(dayRaw);
  if (shiftRaw != null && Number.isFinite(Number(shiftRaw))) out.shiftMoveId = Number(shiftRaw);
  return out;
}

export type OwnershipConsistencyError = {
  code:
    | 'CLIENT_OWNERSHIP_NOT_ALLOWED'
    | 'CLIENT_OWNERSHIP_CONFLICT'
    | 'NO_OPEN_SHIFT'
    | 'SHIFT_BRANCH_MISMATCH'
    | 'SHIFT_DAY_MISMATCH'
    | 'HISTORICAL_SHIFT_NOT_ALLOWED'
    | 'OWNERSHIP_DAY_BRANCH_MISMATCH';
  message: string;
};

function numbersEqual(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  return Number(a) === Number(b);
}

/**
 * Create-path: any client-supplied ownership field is rejected.
 * Server always stamps BranchID / BusinessDayID / ShiftMoveID.
 */
export function rejectClientOwnershipFields(body: unknown): OwnershipConsistencyError | null {
  if (!hasClientOwnershipFields(body)) return null;
  return {
    code: 'CLIENT_OWNERSHIP_NOT_ALLOWED',
    message: 'BranchID / BusinessDayID / ShiftMoveID في الطلب غير مسموح',
  };
}

/**
 * Mutate-path: ignore matching client fields; reject conflicts.
 */
export function rejectConflictingClientOwnership(
  body: unknown,
  server: { branchId: number; businessDayId: number | null; shiftMoveId: number | null },
): OwnershipConsistencyError | null {
  const client = readClientOwnershipFields(body);
  if (client.branchId != null && client.branchId !== Number(server.branchId)) {
    return {
      code: 'CLIENT_OWNERSHIP_CONFLICT',
      message: 'BranchID في الطلب لا يطابق ملكية السجل',
    };
  }
  if (client.businessDayId != null && !numbersEqual(client.businessDayId, server.businessDayId)) {
    return {
      code: 'CLIENT_OWNERSHIP_CONFLICT',
      message: 'BusinessDayID في الطلب لا يطابق ملكية السجل',
    };
  }
  if (client.shiftMoveId != null && !numbersEqual(client.shiftMoveId, server.shiftMoveId)) {
    return {
      code: 'CLIENT_OWNERSHIP_CONFLICT',
      message: 'ShiftMoveID في الطلب لا يطابق ملكية السجل',
    };
  }
  return null;
}

export type ShiftOwnershipRef = {
  branchId: number;
  businessDayId: number | null;
};

/**
 * transaction.BranchID / BusinessDayID / ShiftMoveID must agree with the
 * referenced Branch / BusinessDay / ShiftSession.
 *
 * When SHIFT-scoped (ShiftMoveID present):
 *   Shift.BranchID == transaction.BranchID
 *   Shift.BusinessDayID == transaction.BusinessDayID (when both are present)
 */
export function assertTransactionOwnershipConsistency(
  txn: {
    branchId: number;
    businessDayId: number | null;
    shiftMoveId: number | null;
    scope?: FinancialCommandScope;
  },
  shift?: ShiftOwnershipRef | null,
): OwnershipConsistencyError | null {
  if (txn.scope === 'HISTORICAL' && txn.shiftMoveId != null) {
    return {
      code: 'HISTORICAL_SHIFT_NOT_ALLOWED',
      message: 'العمليات التاريخية لا تُربط بوردية اليوم الحالي',
    };
  }

  if (txn.scope === 'SHIFT' && txn.shiftMoveId == null) {
    return {
      code: 'NO_OPEN_SHIFT',
      message: 'لا يوجد وردية مفتوحة لهذا المستخدم',
    };
  }

  if (txn.shiftMoveId == null) return null;
  if (!shift) return null;

  if (Number(shift.branchId) !== Number(txn.branchId)) {
    return {
      code: 'SHIFT_BRANCH_MISMATCH',
      message: 'الوردية لا تنتمي لفرع المعاملة',
    };
  }
  if (
    txn.businessDayId != null &&
    shift.businessDayId != null &&
    Number(shift.businessDayId) !== Number(txn.businessDayId)
  ) {
    return {
      code: 'SHIFT_DAY_MISMATCH',
      message: 'الوردية لا تنتمي ليوم عمل المعاملة',
    };
  }
  return null;
}

export function currentFinancialOwnership(
  command: FinancialCommand,
  gated: {
    branch: { branchId: number };
    day: { id: number; branchId: number; newDay: string };
    shift: { id: number; branchId: number; businessDayId: number | null } | null;
  },
): { ok: true; ownership: FinancialOwnershipRecord } | { ok: false; error: OwnershipConsistencyError } {
  const policy = getFinancialCommandPolicy(command);
  if (policy.scope === 'HISTORICAL') {
    return {
      ok: false,
      error: {
        code: 'HISTORICAL_SHIFT_NOT_ALLOWED',
        message: 'استخدم السياق التاريخي لهذه العملية',
      },
    };
  }

  if (policy.requiresOpenShift && !gated.shift) {
    return {
      ok: false,
      error: {
        code: 'NO_OPEN_SHIFT',
        message: 'لا يوجد وردية مفتوحة لهذا المستخدم',
      },
    };
  }

  if (gated.day.branchId !== gated.branch.branchId) {
    return {
      ok: false,
      error: {
        code: 'OWNERSHIP_DAY_BRANCH_MISMATCH',
        message: 'يوم العمل لا ينتمي للفرع المحدد',
      },
    };
  }

  const hasShift = Boolean(gated.shift);
  const scope: FinancialCommandScope = hasShift ? 'SHIFT' : 'DAY';
  const ownership: FinancialOwnershipRecord = {
    scope,
    branchId: gated.branch.branchId,
    businessDayId: gated.day.id,
    businessDate: gated.day.newDay,
    shiftMoveId: gated.shift?.id ?? null,
  };

  const mismatch = assertTransactionOwnershipConsistency(ownership, gated.shift);
  if (mismatch) return { ok: false, error: mismatch };
  return { ok: true, ownership };
}

export function historicalFinancialContext(
  branchId: number,
  day: { id: number; branchId: number; newDay: string },
): { ok: true; ownership: HistoricalFinancialContext } | { ok: false; error: OwnershipConsistencyError } {
  if (Number(day.branchId) !== Number(branchId)) {
    return {
      ok: false,
      error: {
        code: 'OWNERSHIP_DAY_BRANCH_MISMATCH',
        message: 'يوم العمل لا ينتمي للفرع المحدد',
      },
    };
  }
  const ownership: HistoricalFinancialContext = {
    scope: 'HISTORICAL',
    branchId,
    businessDayId: day.id,
    businessDate: day.newDay,
    shiftMoveId: null,
  };
  return { ok: true, ownership };
}

export function inferMutationScope(shiftMoveId: number | null): FinancialCommandScope {
  return shiftMoveId != null ? 'SHIFT' : 'DAY';
}

export function ownershipErrorResponse(error: OwnershipConsistencyError): NextResponse {
  return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
}

export function finalizeCurrentFinancialWrite(
  command: FinancialCommand,
  gated: {
    branch: { branchId: number };
    day: { id: number; branchId: number; newDay: string };
    shift: { id: number; branchId: number; businessDayId: number | null } | null;
  },
  body?: unknown,
):
  | { ok: true; ownership: FinancialOwnershipRecord }
  | { ok: false; response: NextResponse } {
  const clientErr = rejectClientOwnershipFields(body);
  if (clientErr) return { ok: false, response: ownershipErrorResponse(clientErr) };
  const result = currentFinancialOwnership(command, gated);
  if (!result.ok) return { ok: false, response: ownershipErrorResponse(result.error) };
  return result;
}

export function finalizeHistoricalFinancialWrite(
  branchId: number,
  day: { id: number; branchId: number; newDay: string },
  body?: unknown,
):
  | { ok: true; ownership: HistoricalFinancialContext }
  | { ok: false; response: NextResponse } {
  const clientErr = rejectClientOwnershipFields(body);
  if (clientErr) return { ok: false, response: ownershipErrorResponse(clientErr) };
  const result = historicalFinancialContext(branchId, day);
  if (!result.ok) return { ok: false, response: ownershipErrorResponse(result.error) };
  return result;
}

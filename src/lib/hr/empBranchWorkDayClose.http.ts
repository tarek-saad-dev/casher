import { NextResponse } from 'next/server';
import { EmpBranchWorkDayCloseError } from '@/lib/hr/empBranchWorkDayClose.types';
import { PAYROLL_DAY_CLOSED_CODE } from '@/lib/hr/empBranchWorkDayClose.transitions';

/** Map close-domain errors to HTTP responses. */
export function empBranchWorkDayCloseErrorResponse(
  error: EmpBranchWorkDayCloseError,
): NextResponse {
  const status =
    error.code === PAYROLL_DAY_CLOSED_CODE
      ? 409
      : error.code === 'NOT_READY_TO_CLOSE'
        ? 409
        : error.code === 'INVALID_TRANSITION' ||
            error.code === 'REOPEN_REASON_REQUIRED' ||
            error.code === 'REOPEN_REASON_TOO_LONG' ||
            error.code === 'INVALID_ACTOR' ||
            error.code === 'INVALID_WORK_DATE' ||
            error.code === 'INVALID_BRANCH'
          ? 400
          : error.code === 'CONCURRENT_MODIFICATION'
            ? 409
            : 400;

  return NextResponse.json({ error: error.message, code: error.code }, { status });
}

export function isEmpBranchWorkDayCloseError(
  err: unknown,
): err is EmpBranchWorkDayCloseError {
  return err instanceof EmpBranchWorkDayCloseError;
}

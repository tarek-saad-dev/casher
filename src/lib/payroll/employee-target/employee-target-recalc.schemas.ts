import { assertValidWorkDate, EmployeeTargetValidationError } from './target.validation';

export type TargetRecalcRequestStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed';

export type TargetSyncStatus = 'up_to_date' | 'pending' | 'processing' | 'failed';

export interface EnqueueRecalcBody {
  workDate: string;
  empIds?: number[] | null;
  processNow: boolean;
  reason?: string;
}

export interface ProcessRecalcBody {
  workDate?: string;
  empIds?: number[] | null;
  requestIds?: number[] | null;
  maxRequests: number;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseEmpIds(raw: unknown): number[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) {
    throw new EmployeeTargetValidationError('empIds يجب أن يكون مصفوفة أرقام');
  }
  const ids = [...new Set(raw.map((x) => Number(x)).filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) {
    throw new EmployeeTargetValidationError('empIds غير صالحة');
  }
  return ids;
}

export function parseEnqueueRecalcBody(body: unknown): EnqueueRecalcBody {
  if (!isPlainObject(body)) throw new EmployeeTargetValidationError('بيانات غير صالحة');
  const workDate = String(body.workDate ?? '').slice(0, 10);
  assertValidWorkDate(workDate);
  return {
    workDate,
    empIds: parseEmpIds(body.empIds),
    processNow: body.processNow === undefined ? true : Boolean(body.processNow),
    reason: body.reason != null ? String(body.reason).slice(0, 100) : undefined,
  };
}

export function parseProcessRecalcBody(body: unknown): ProcessRecalcBody {
  if (body == null) {
    throw new EmployeeTargetValidationError(
      'يجب تحديد نطاق: workDate أو requestIds — المعالجة غير المحدودة مرفوضة',
    );
  }
  if (!isPlainObject(body)) throw new EmployeeTargetValidationError('بيانات غير صالحة');

  const workDateRaw = body.workDate != null ? String(body.workDate).slice(0, 10) : undefined;
  if (workDateRaw) assertValidWorkDate(workDateRaw);

  let requestIds: number[] | null = null;
  if (body.requestIds != null) {
    if (!Array.isArray(body.requestIds)) {
      throw new EmployeeTargetValidationError('requestIds غير صالحة');
    }
    requestIds = [
      ...new Set(
        body.requestIds.map((x) => Number(x)).filter((id) => Number.isInteger(id) && id > 0),
      ),
    ];
    if (requestIds.length === 0) {
      throw new EmployeeTargetValidationError('requestIds غير صالحة');
    }
  }

  const maxRequests = body.maxRequests == null ? 50 : Number(body.maxRequests);
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 200) {
    throw new EmployeeTargetValidationError('maxRequests يجب أن يكون بين 1 و 200');
  }

  if (!workDateRaw && !requestIds) {
    throw new EmployeeTargetValidationError(
      'يجب تحديد نطاق: workDate أو requestIds — المعالجة غير المحدودة مرفوضة',
    );
  }

  return {
    workDate: workDateRaw,
    empIds: parseEmpIds(body.empIds),
    requestIds,
    maxRequests,
  };
}

export function sanitizeRecalcError(err: unknown): string {
  const msg = err instanceof Error ? err.message : 'فشل تحديث التارجت';
  if (/SELECT|INSERT|UPDATE|DELETE|mssql|ECONN|timeout|Invalid object|syntax/i.test(msg)) {
    return 'تعذر تحديث التارجت — حاول إعادة المحاولة لاحقًا';
  }
  return msg.slice(0, 500);
}

export type TargetPersistenceStatus = 'not_generated' | 'generated' | 'recalculated';

export type TargetDisplayStatus = 'no_sales' | 'below_first_tier' | 'earned_target';

export type TargetUpsertStatus = 'generated' | 'recalculated';

export interface DailyTargetGenerateBody {
  workDate: string;
  empIds?: number[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDailyTargetGenerateBody(body: unknown): DailyTargetGenerateBody {
  if (!body || typeof body !== 'object') {
    throw new Error('بيانات غير صالحة');
  }
  const b = body as Record<string, unknown>;
  if (typeof b.workDate !== 'string' || !DATE_RE.test(b.workDate)) {
    throw new Error('workDate مطلوب بصيغة YYYY-MM-DD');
  }

  let empIds: number[] | undefined;
  if (b.empIds !== undefined && b.empIds !== null) {
    if (!Array.isArray(b.empIds)) {
      throw new Error('empIds يجب أن تكون مصفوفة أرقام');
    }
    const parsed: number[] = [];
    const seen = new Set<number>();
    for (const raw of b.empIds) {
      const id = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error('empIds تحتوي معرف موظف غير صالح');
      }
      if (seen.has(id)) {
        throw new Error('empIds تحتوي تكرارًا');
      }
      seen.add(id);
      parsed.push(id);
    }
    empIds = parsed;
  }

  return { workDate: b.workDate, empIds };
}

export function parseWorkDateQuery(value: string | null): string {
  if (!value || !DATE_RE.test(value)) {
    throw new Error('workDate مطلوب بصيغة YYYY-MM-DD');
  }
  return value;
}

export function deriveTargetDisplayStatus(
  netSalesAfterDiscount: number | string,
  targetAmount: number | string,
): TargetDisplayStatus {
  const sales = Number(netSalesAfterDiscount);
  const target = Number(targetAmount);
  if (!Number.isFinite(sales) || sales <= 0) return 'no_sales';
  if (!Number.isFinite(target) || target <= 0) return 'below_first_tier';
  return 'earned_target';
}

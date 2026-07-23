/**
 * Per-barber service duration resolution.
 *
 * Source of truth order (matches /admin/services barber-durations UI):
 *   1. Active TblEmpServiceSettings override for (EmpID, ProID)
 *   2. TblPro.DurationMinutes
 *   3. System default (QueueBookingSettings / 30)
 *
 * Eligibility is NEVER derived from TblEmpServiceSettings.
 */

import { getPool, sql } from '@/lib/db';
import { getDefaultDuration } from '@/lib/queueEstimateEngine';
import { getServiceActiveWhereClause } from '@/lib/tblProSql';

export type EmpDurationSource =
  | 'EMP_SERVICE_OVERRIDE'
  | 'SERVICE_DEFAULT'
  | 'SYSTEM_DEFAULT'
  | 'MIXED'
  | 'LEGACY_FALLBACK'
  | 'EMPTY';

export interface EmpServiceDurationLine {
  serviceId: number;
  serviceName: string;
  durationMinutes: number;
  price: number;
  sequence: number;
  durationSource: 'EMP_SERVICE_OVERRIDE' | 'SERVICE_DEFAULT' | 'SYSTEM_DEFAULT';
}

export interface EmpServiceDurationPlan {
  empId: number | null;
  serviceIds: number[];
  totalDurationMinutes: number;
  totalPrice: number;
  durationSource: EmpDurationSource;
  services: EmpServiceDurationLine[];
}

export class EmpServiceDurationError extends Error {
  readonly code = 'SERVICE_NOT_AVAILABLE' as const;
  readonly status = 400;

  constructor(message = 'إحدى الخدمات المختارة غير متاحة') {
    super(message);
    this.name = 'EmpServiceDurationError';
  }
}

function isServiceDeleted(isDeleted: boolean | number | null | undefined): boolean {
  return isDeleted === true || isDeleted === 1;
}

/** Pure resolve for one service — used by tests and batch aggregation. */
export function resolveOneServiceDuration(input: {
  overrideMinutes?: number | null;
  serviceDefaultMinutes?: number | null;
  systemDefaultMinutes: number;
}): {
  durationMinutes: number;
  durationSource: 'EMP_SERVICE_OVERRIDE' | 'SERVICE_DEFAULT' | 'SYSTEM_DEFAULT';
} {
  const override = input.overrideMinutes;
  if (override != null && Number.isFinite(override) && override > 0) {
    return { durationMinutes: Math.round(override), durationSource: 'EMP_SERVICE_OVERRIDE' };
  }
  const serviceDefault = input.serviceDefaultMinutes;
  if (serviceDefault != null && Number.isFinite(serviceDefault) && serviceDefault > 0) {
    return { durationMinutes: Math.round(serviceDefault), durationSource: 'SERVICE_DEFAULT' };
  }
  const system = input.systemDefaultMinutes > 0 ? input.systemDefaultMinutes : 30;
  return { durationMinutes: Math.round(system), durationSource: 'SYSTEM_DEFAULT' };
}

export function aggregateDurationSource(
  sources: Array<EmpServiceDurationLine['durationSource']>,
): EmpDurationSource {
  if (!sources.length) return 'EMPTY';
  const unique = new Set(sources);
  if (unique.size === 1) return sources[0]!;
  return 'MIXED';
}

/**
 * Batch-load active duration overrides for many barbers × services.
 * Key: `${empId}:${proId}` → minutes
 */
export async function loadEmpServiceDurationOverrides(
  empIds: number[],
  serviceIds: number[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!empIds.length || !serviceIds.length) return map;

  const uniqueEmps = [...new Set(empIds.filter((id) => Number.isFinite(id) && id > 0))];
  const uniquePros = [...new Set(serviceIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (!uniqueEmps.length || !uniquePros.length) return map;

  try {
    const db = await getPool();
    const res = await db.request().query(`
      SELECT EmpID, ProID, DurationMinutes
      FROM dbo.TblEmpServiceSettings
      WHERE IsActive = 1
        AND EmpID IN (${uniqueEmps.join(',')})
        AND ProID IN (${uniquePros.join(',')})
        AND DurationMinutes IS NOT NULL
        AND DurationMinutes > 0
    `);
    for (const row of res.recordset) {
      map.set(`${row.EmpID}:${row.ProID}`, Number(row.DurationMinutes));
    }
  } catch {
    /* table may not exist yet */
  }
  return map;
}

async function loadServiceRows(
  serviceIds: number[],
): Promise<Map<number, {
  ProID: number;
  ProName: string;
  SPrice1: number;
  DurationMinutes: number | null;
  isDeleted: boolean | number | null;
}>> {
  const byId = new Map<number, {
    ProID: number;
    ProName: string;
    SPrice1: number;
    DurationMinutes: number | null;
    isDeleted: boolean | number | null;
  }>();
  if (!serviceIds.length) return byId;

  const uniqueIds = [...new Set(serviceIds)];
  const db = await getPool();
  const r = db.request();
  uniqueIds.forEach((id, i) => r.input(`id${i}`, sql.Int, id));
  const activeWhere = getServiceActiveWhereClause('p');
  const res = await r.query(`
    SELECT p.ProID, p.ProName, ISNULL(p.SPrice1, 0) AS SPrice1,
           p.DurationMinutes, p.isDeleted
    FROM [dbo].[TblPro] p
    WHERE p.ProID IN (${uniqueIds.map((_, i) => `@id${i}`).join(',')})
      AND ${activeWhere}
  `);
  for (const row of res.recordset) {
    byId.set(row.ProID, row);
  }
  return byId;
}

/**
 * Resolve a full duration plan for one barber (or catalog defaults when empId null).
 */
export async function resolveEmpServiceDurationPlan(args: {
  serviceIds: number[];
  empId?: number | null;
  systemDefaultMinutes?: number;
  /** Preloaded overrides map from loadEmpServiceDurationOverrides */
  overrideMap?: Map<string, number>;
}): Promise<EmpServiceDurationPlan> {
  const serviceIds = args.serviceIds ?? [];
  const empId = args.empId != null && args.empId > 0 ? args.empId : null;
  const systemDefault =
    args.systemDefaultMinutes ?? (await getDefaultDuration());

  if (!serviceIds.length) {
    return {
      empId,
      serviceIds: [],
      totalDurationMinutes: systemDefault,
      totalPrice: 0,
      durationSource: 'LEGACY_FALLBACK',
      services: [],
    };
  }

  const [byId, overrideMap] = await Promise.all([
    loadServiceRows(serviceIds),
    args.overrideMap
      ? Promise.resolve(args.overrideMap)
      : empId
        ? loadEmpServiceDurationOverrides([empId], serviceIds)
        : Promise.resolve(new Map<string, number>()),
  ]);

  const services: EmpServiceDurationLine[] = [];
  let sequence = 0;

  for (const sid of serviceIds) {
    const row = byId.get(sid);
    if (!row || isServiceDeleted(row.isDeleted)) {
      throw new EmpServiceDurationError();
    }
    const override =
      empId != null ? overrideMap.get(`${empId}:${sid}`) ?? null : null;
    const resolved = resolveOneServiceDuration({
      overrideMinutes: override,
      serviceDefaultMinutes: row.DurationMinutes,
      systemDefaultMinutes: systemDefault,
    });
    if (!resolved.durationMinutes || resolved.durationMinutes <= 0) {
      throw new Error(`الخدمة "${row.ProName}" بدون مدة محددة`);
    }
    sequence += 1;
    services.push({
      serviceId: row.ProID,
      serviceName: row.ProName,
      durationMinutes: resolved.durationMinutes,
      price: Number(row.SPrice1) || 0,
      sequence,
      durationSource: resolved.durationSource,
    });
  }

  return {
    empId,
    serviceIds: [...serviceIds],
    totalDurationMinutes: services.reduce((s, l) => s + l.durationMinutes, 0),
    totalPrice: services.reduce((s, l) => s + l.price, 0),
    durationSource: aggregateDurationSource(services.map((l) => l.durationSource)),
    services,
  };
}

/**
 * Resolve totals for many barbers in one override round-trip.
 * Returns Map<empId, totalMinutes>.
 */
export async function resolveDurationTotalsByEmp(args: {
  empIds: number[];
  serviceIds: number[];
  systemDefaultMinutes?: number;
}): Promise<{
  totals: Map<number, number>;
  sources: Map<number, EmpDurationSource>;
  basePlan: EmpServiceDurationPlan;
  plans: Map<number, EmpServiceDurationPlan>;
}> {
  const { empIds, serviceIds } = args;
  const systemDefault =
    args.systemDefaultMinutes ?? (await getDefaultDuration());

  const basePlan = await resolveEmpServiceDurationPlan({
    serviceIds,
    empId: null,
    systemDefaultMinutes: systemDefault,
  });

  const totals = new Map<number, number>();
  const sources = new Map<number, EmpDurationSource>();
  const plans = new Map<number, EmpServiceDurationPlan>();
  if (!empIds.length) {
    return { totals, sources, basePlan, plans };
  }

  const overrideMap = await loadEmpServiceDurationOverrides(empIds, serviceIds);
  const uniqueEmps = [...new Set(empIds.filter((id) => id > 0))];

  for (const empId of uniqueEmps) {
    const services: EmpServiceDurationLine[] = basePlan.services.map((line) => {
      const override = overrideMap.get(`${empId}:${line.serviceId}`);
      if (override != null && override > 0) {
        return {
          ...line,
          durationMinutes: Math.round(override),
          durationSource: 'EMP_SERVICE_OVERRIDE' as const,
        };
      }
      return { ...line };
    });

    const plan: EmpServiceDurationPlan = {
      empId,
      serviceIds: [...serviceIds],
      totalDurationMinutes: services.reduce((s, l) => s + l.durationMinutes, 0),
      totalPrice: services.reduce((s, l) => s + l.price, 0),
      durationSource: aggregateDurationSource(services.map((l) => l.durationSource)),
      services,
    };
    totals.set(empId, plan.totalDurationMinutes);
    sources.set(empId, plan.durationSource);
    plans.set(empId, plan);
  }

  return { totals, sources, basePlan, plans };
}

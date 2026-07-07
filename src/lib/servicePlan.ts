/**
 * Canonical multi-service plan — sequential services on one barber, one continuous block.
 */

import { getPool, sql } from '@/lib/db';
import { getDefaultDuration } from '@/lib/queueEstimateEngine';
import { calculateEndTime } from '@/lib/bookingDateTime';
import { getServiceActiveWhereClause } from '@/lib/tblProSql';

const DEV = process.env.NODE_ENV !== 'production';

export class ServicePlanError extends Error {
  readonly code = 'SERVICE_NOT_AVAILABLE' as const;
  readonly status = 400;

  constructor(message = 'إحدى الخدمات المختارة غير متاحة') {
    super(message);
    this.name = 'ServicePlanError';
  }
}

function isServiceDeleted(isDeleted: boolean | number | null | undefined): boolean {
  return isDeleted === true || isDeleted === 1;
}

export interface ServicePlanLine {
  serviceId: number;
  serviceName: string;
  durationMinutes: number;
  price: number;
  sequence: number;
}

export interface ServicePlanDuration {
  serviceIds: number[];
  totalDurationMinutes: number;
  totalPrice: number;
  durationSource: 'SERVICE_SUM' | 'LEGACY_FALLBACK' | 'EMPTY';
  services: ServicePlanLine[];
}

export interface SequentialServicePlanLine extends ServicePlanLine {
  empId: number;
  startAt: string;
  endAt: string;
}

export interface SequentialServicePlan {
  empId: number;
  startAt: string;
  endAt: string;
  totalDurationMinutes: number;
  totalPrice: number;
  lines: SequentialServicePlanLine[];
}

async function loadServicesInOrder(
  db: Awaited<ReturnType<typeof getPool>>,
  serviceIds: number[],
  defaultDur: number,
): Promise<ServicePlanLine[]> {
  if (!serviceIds.length) return [];

  const uniqueIds = [...new Set(serviceIds)];
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

  const byId = new Map<number, {
    ProID: number;
    ProName: string;
    SPrice1: number;
    DurationMinutes: number | null;
    isDeleted: boolean | number | null;
  }>();
  for (const row of res.recordset) {
    byId.set(row.ProID, row);
  }

  const lines: ServicePlanLine[] = [];
  let sequence = 0;

  for (const sid of serviceIds) {
    const row = byId.get(sid);
    if (!row || isServiceDeleted(row.isDeleted)) {
      throw new ServicePlanError();
    }
    const durationMinutes = row.DurationMinutes ?? defaultDur;
    if (!durationMinutes || durationMinutes <= 0) {
      throw new Error(`الخدمة "${row.ProName}" بدون مدة محددة`);
    }
    sequence += 1;
    lines.push({
      serviceId: row.ProID,
      serviceName: row.ProName,
      durationMinutes,
      price: Number(row.SPrice1) || 0,
      sequence,
    });
  }

  return lines;
}

/**
 * Sum durations and prices for selected services in user selection order.
 */
export async function calculateServicePlanDuration(
  serviceIds: number[],
): Promise<ServicePlanDuration> {
  const db = await getPool();
  const defaultDur = await getDefaultDuration(db);

  if (!serviceIds.length) {
    if (DEV) {
      console.warn('[servicePlan] LEGACY_FALLBACK: empty serviceIds, using default', defaultDur);
    }
    return {
      serviceIds: [],
      totalDurationMinutes: defaultDur,
      totalPrice: 0,
      durationSource: 'LEGACY_FALLBACK',
      services: [],
    };
  }

  const services = await loadServicesInOrder(db, serviceIds, defaultDur);
  const totalDurationMinutes = services.reduce((s, l) => s + l.durationMinutes, 0);
  const totalPrice = services.reduce((s, l) => s + l.price, 0);

  const usedFallback = services.some((l) => l.durationMinutes === defaultDur);
  if (DEV && usedFallback) {
    console.warn('[servicePlan] Some services used system default duration', defaultDur);
  }

  return {
    serviceIds: [...serviceIds],
    totalDurationMinutes,
    totalPrice,
    durationSource: 'SERVICE_SUM',
    services,
  };
}

/**
 * Build ordered per-service intervals within one continuous block on one barber.
 */
export async function buildSequentialServicePlan(args: {
  serviceIds: number[];
  startAt: string | Date;
  empId: number;
}): Promise<SequentialServicePlan> {
  const plan = await calculateServicePlanDuration(args.serviceIds);
  const start = typeof args.startAt === 'string' ? new Date(args.startAt) : args.startAt;

  let cursor = start.getTime();
  const lines: SequentialServicePlanLine[] = plan.services.map((svc) => {
    const lineStart = new Date(cursor);
    const lineEnd = calculateEndTime(lineStart, svc.durationMinutes);
    cursor = lineEnd.getTime();
    return {
      ...svc,
      empId: args.empId,
      startAt: lineStart.toISOString(),
      endAt: lineEnd.toISOString(),
    };
  });

  return {
    empId: args.empId,
    startAt: start.toISOString(),
    endAt: new Date(cursor).toISOString(),
    totalDurationMinutes: plan.totalDurationMinutes,
    totalPrice: plan.totalPrice,
    lines,
  };
}

/** Sync helper when service rows are already loaded */
export function buildSequentialServicePlanFromLines(args: {
  lines: ServicePlanLine[];
  startAt: string | Date;
  empId: number;
}): SequentialServicePlan {
  const start = typeof args.startAt === 'string' ? new Date(args.startAt) : args.startAt;
  let cursor = start.getTime();
  const seqLines: SequentialServicePlanLine[] = args.lines.map((svc) => {
    const lineStart = new Date(cursor);
    const lineEnd = calculateEndTime(lineStart, svc.durationMinutes);
    cursor = lineEnd.getTime();
    return {
      ...svc,
      empId: args.empId,
      startAt: lineStart.toISOString(),
      endAt: lineEnd.toISOString(),
    };
  });

  return {
    empId: args.empId,
    startAt: start.toISOString(),
    endAt: new Date(cursor).toISOString(),
    totalDurationMinutes: args.lines.reduce((s, l) => s + l.durationMinutes, 0),
    totalPrice: args.lines.reduce((s, l) => s + l.price, 0),
    lines: seqLines,
  };
}

export { formatServiceSummary } from '@/lib/servicePlanFormat';

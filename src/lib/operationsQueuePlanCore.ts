import { getPool } from '@/lib/db';
import { getCairoBusinessDate } from '@/lib/businessDate';
import { listAvailableBookingSlots } from '@/lib/bookingAvailabilityEngine';
import { calculateServicePlanDuration, ServicePlanError } from '@/lib/servicePlan';
import { simulateQueueInsertion } from '@/lib/operationsQueueTimeline';
import type { QueuePlanAlternative, QueuePlanForBarberResult } from '@/lib/operationsQueueTypes';

export type { QueuePlanAlternative, QueuePlanForBarberResult } from '@/lib/operationsQueueTypes';

export class QueuePlanForBarberError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'QueuePlanForBarberError';
    this.status = status;
    this.code = code;
  }
}

export async function planQueueForBarber(args: {
  empId: number;
  serviceIds: number[];
  date?: string;
  requestedFrom?: string;
  source?: string;
}): Promise<QueuePlanForBarberResult> {
  const { empId, serviceIds } = args;
  const requestedFrom = args.requestedFrom ?? new Date().toISOString();
  const date = args.date ?? getCairoBusinessDate(new Date(requestedFrom));

  if (!empId) {
    throw new QueuePlanForBarberError(400, 'INVALID_EMP', 'empId مطلوب');
  }
  if (!serviceIds.length) {
    throw new QueuePlanForBarberError(400, 'NO_SERVICES', 'اختر خدمة واحدة على الأقل');
  }

  const db = await getPool();
  const empRes = await db.request().query(
    `SELECT TOP 1 EmpName FROM [dbo].[TblEmp] WHERE EmpID = ${empId}`,
  );
  const empName = empRes.recordset[0]?.EmpName as string | undefined;
  if (!empName) {
    throw new QueuePlanForBarberError(404, 'BARBER_NOT_FOUND', 'الحلاق غير موجود');
  }

  let servicePlan;
  try {
    servicePlan = await calculateServicePlanDuration(serviceIds);
  } catch (err) {
    if (err instanceof ServicePlanError) {
      throw new QueuePlanForBarberError(400, err.code, err.message);
    }
    throw err;
  }

  const slotsResult = await listAvailableBookingSlots({
    date,
    serviceIds,
    mode: 'specific',
    empId,
    source: 'operations',
  });

  const matching = slotsResult.availableSlots.filter(
    (s) =>
      s.durationMinutes === servicePlan.totalDurationMinutes
      && new Date(s.startAt).getTime() >= new Date(requestedFrom).getTime(),
  );

  if (!matching.length) {
    const barberLabel = empName;
    return {
      available: false,
      code: 'NO_AVAILABLE_INTERVAL',
      message: `لا توجد فترة متصلة مدتها ${servicePlan.totalDurationMinutes} دقيقة مع ${barberLabel} اليوم`,
      empId,
      empName,
      serviceIds,
      totalDurationMinutes: servicePlan.totalDurationMinutes,
    };
  }

  const primary = matching[0];
  const alternatives: QueuePlanAlternative[] = matching.slice(1, 4).map((s) => ({
    startAt: s.startAt,
    endAt: s.endAt,
    durationMinutes: s.durationMinutes,
    label: s.label,
  }));

  const simulation = await simulateQueueInsertion({
    empId,
    serviceIds,
    requestedAt: requestedFrom,
  });

  return {
    available: true,
    empId,
    empName,
    serviceIds,
    totalDurationMinutes: servicePlan.totalDurationMinutes,
    totalPrice: servicePlan.totalPrice,
    expectedStartAt: primary.startAt,
    expectedEndAt: primary.endAt,
    waitingCountAtCreation: simulation.ok ? simulation.peopleBefore : 0,
    alternatives,
  };
}

import { getPool, sql } from '@/lib/db';
import { simulateQueueInsertion } from '@/lib/operationsQueueTimeline';
import {
  getDefaultDuration,
  getServicesDuration,
  buildQueueIntervals,
  buildBookingIntervals,
} from '@/lib/queueEstimateEngine';
import { getCairoBusinessDate } from '@/lib/businessDate';
import { normalizeCustomersAhead } from '@/lib/queueCustomersAhead';
import { intervalsOverlap } from '@/lib/scheduleIntervals';
import {
  assertEmployeeIntervalAvailable,
  ScheduleConflictError,
} from '@/lib/scheduleIntegrity';
import { getBarberAvailabilityReason } from '@/lib/barberAvailability';
import { generateTicketCode } from '@/lib/queueTicketCode';
import { detectQueueTicketsSchema, buildInsertColumns } from '@/lib/queueSchema';
import { getChairNumber } from '@/lib/chairMapping';
import { findNearestBarberForServices } from '@/lib/queueNearestBarber';
import {
  QUICK_QUEUE_SERVICE_ID,
  QUICK_QUEUE_WALK_IN_NAME,
  QUICK_QUEUE_ENABLED,
} from '@/lib/quickQueueConfig';
import type { CreateQueueResponse } from '@/lib/operationsQueueTypes';

export interface CreateOperationsQueueInput {
  empId: number;
  serviceIds: number[];
  customer?: {
    clientId?: number;
    name?: string;
    phone?: string;
  };
  expectedStartTime: string;
  expectedEndTime: string;
  source: 'walk_in' | 'booking' | 'reschedule';
  /** When true, skip the 5-minute client/simulation drift check (server-orchestrated flows). */
  trustExpectedStart?: boolean;
}

export class CreateOperationsQueueError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(status: number, message: string, payload: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

export async function createOperationsQueueTicket(
  input: CreateOperationsQueueInput,
): Promise<CreateQueueResponse> {
  const db = await getPool();
  const transaction = new sql.Transaction(db);
  const {
    empId,
    serviceIds,
    customer,
    expectedStartTime,
    expectedEndTime,
    source,
    trustExpectedStart = false,
  } = input;

  if (!empId || typeof empId !== 'number') {
    throw new CreateOperationsQueueError(400, 'empId مطلوب');
  }

  if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
    throw new CreateOperationsQueueError(400, 'serviceIds مطلوب');
  }

  if (!expectedStartTime || !expectedEndTime) {
    throw new CreateOperationsQueueError(400, 'expectedStartTime و expectedEndTime مطلوبان');
  }

  const empRes = await db
    .request()
    .input('eid', sql.Int, empId)
    .query(`SELECT TOP 1 EmpName FROM [dbo].[TblEmp] WHERE EmpID = @eid`);
  const empName = empRes.recordset[0]?.EmpName ?? '';

  const availGuard = await getBarberAvailabilityReason(empId, new Date());
  if (!availGuard.available) {
    throw new CreateOperationsQueueError(409, availGuard.reason ?? 'الحلاق غير متاح', {
      reason: 'barber_unavailable',
    });
  }

  const defaultDur = await getDefaultDuration(db);
  const serviceDur = await getServicesDuration(db, serviceIds, defaultDur);

  const simulation = await simulateQueueInsertion({
    empId,
    serviceIds,
    requestedAt: new Date().toISOString(),
  });

  if (!simulation.ok) {
    throw new CreateOperationsQueueError(409, simulation.message, {
      newSuggestion: simulation,
    });
  }

  const suggestedStartTime = new Date(simulation.suggestedStartTime);
  const suggestedEndTime = new Date(suggestedStartTime.getTime() + serviceDur * 60000);

  const now = new Date();
  const operationalDate = getCairoBusinessDate(now);
  const checkDateStr = operationalDate;

  const qIvs = await buildQueueIntervals(db, empId, checkDateStr, now, defaultDur, undefined, {
    filterStale: true,
    graceMinutes: 30,
    debugContext: 'ops-queue-create',
  });
  const bIvs = await buildBookingIntervals(db, empId, checkDateStr, defaultDur);

  const bookingConflicts = bIvs.filter((b: { start: Date; end: Date }) =>
    intervalsOverlap(suggestedStartTime, suggestedEndTime, b.start, b.end),
  );
  const queueConflicts = qIvs.filter((q: { start: Date; end: Date }) =>
    intervalsOverlap(suggestedStartTime, suggestedEndTime, q.start, q.end),
  );

  if (bookingConflicts.length > 0 || queueConflicts.length > 0) {
    throw new CreateOperationsQueueError(409, 'الوقت المقترح يتعارض مع حجز أو دور موجود', {
      conflicts: {
        bookings: bookingConflicts.map((b: { id: number; start: Date; end: Date }) => ({
          id: b.id,
          start: b.start.toISOString(),
          end: b.end.toISOString(),
        })),
        queue: queueConflicts.map(
          (q: { id: number; ticketCode?: string; start: Date; end: Date }) => ({
            id: q.id,
            code: q.ticketCode,
            start: q.start.toISOString(),
            end: q.end.toISOString(),
          }),
        ),
      },
    });
  }

  if (!trustExpectedStart) {
    const requestedStart = new Date(expectedStartTime).getTime();
    const suggestedStart = new Date(simulation.suggestedStartTime).getTime();
    const timeDiffMinutes = Math.abs(requestedStart - suggestedStart) / 60000;

    if (timeDiffMinutes > 5) {
      throw new CreateOperationsQueueError(409, 'الوقت المطلوب لم يعد متاحاً، تم تحديث الجدول', {
        newSuggestion: simulation,
        reason: `الوقت المقترح الآن: ${simulation.suggestedStartTime}`,
      });
    }
  }

  const finalStartTime = simulation.suggestedStartTime;
  const finalStartDate = new Date(finalStartTime);
  const finalEndDate = new Date(finalStartDate.getTime() + serviceDur * 60000);
  const dateStr = operationalDate;
  const ticketCode = await generateTicketCode(db, dateStr, 'W');

  const servicesRes = await db.request().query(`
    SELECT ProID, ProName, DurationMinutes, SPrice1
    FROM [dbo].[TblPro]
    WHERE ProID IN (${serviceIds.join(',')})
  `);
  const servicesMap = new Map(
    servicesRes.recordset.map((s: { ProID: number; ProName: string; DurationMinutes: number | null; SPrice1: number | null }) => [
      s.ProID,
      { name: s.ProName, duration: s.DurationMinutes ?? defaultDur, price: s.SPrice1 },
    ]),
  );

  const schema = await detectQueueTicketsSchema();
  const nowMs = new Date().getTime();
  const startMs = new Date(finalStartTime).getTime();
  const estimatedWaitMinutes = Math.max(0, Math.round((startMs - nowMs) / 60000));
  const { columns, paramNames } = buildInsertColumns(schema);

  await transaction.begin();

  try {
    await assertEmployeeIntervalAvailable({
      empId,
      startAt: finalStartDate,
      endAt: finalEndDate,
      now,
      operationalDate: dateStr,
      transaction,
    });

    let clientId: number | null = null;
    let resolvedCustomerName = customer?.name || null;
    let resolvedCustomerPhone = customer?.phone || null;

    if (customer?.clientId && schema.hasClientID) {
      clientId = customer.clientId;
    } else if (customer?.phone) {
      try {
        const findClient = await transaction
          .request()
          .input('phone', sql.NVarChar, customer.phone)
          .query(`
            SELECT TOP 1 ClientID, Name, Mobile
            FROM [dbo].[TblClient]
            WHERE Mobile = @phone OR Mobile2 = @phone
          `);

        if (findClient.recordset.length > 0) {
          clientId = findClient.recordset[0].ClientID;
          resolvedCustomerName = findClient.recordset[0].Name;
          resolvedCustomerPhone = findClient.recordset[0].Mobile;
        } else if (customer.name && schema.hasClientID) {
          const createClient = await transaction
            .request()
            .input('name', sql.NVarChar, customer.name)
            .input('phone', sql.NVarChar, customer.phone)
            .query(`
              INSERT INTO [dbo].[TblClient] (Name, Mobile)
              OUTPUT INSERTED.ClientID
              VALUES (@name, @phone);
            `);
          if (createClient.recordset.length > 0) {
            clientId = createClient.recordset[0].ClientID;
          }
        }
      } catch (clientErr) {
        console.log('[operationsQueueCreateCore] Customer lookup/creation skipped:', clientErr);
      }
    }

    const ticketRequest = transaction
      .request()
      .input('ticketCode', sql.NVarChar, ticketCode)
      .input('queueDate', sql.Date, dateStr)
      .input('empId', sql.Int, empId)
      .input('status', sql.NVarChar, 'waiting')
      .input('source', sql.NVarChar, source)
      .input('estimatedStartTime', sql.DateTime, new Date(finalStartTime));

    if (schema.hasTicketPrefix) {
      ticketRequest.input('ticketPrefix', sql.NVarChar, 'W');
    }
    if (schema.hasClientID) {
      ticketRequest.input('clientId', sql.Int, clientId);
    }
    if (schema.hasCustomerName) {
      ticketRequest.input('customerName', sql.NVarChar, resolvedCustomerName);
    }
    if (schema.hasCustomerPhone) {
      ticketRequest.input('customerPhone', sql.NVarChar, resolvedCustomerPhone);
    }
    if (schema.hasPriority) {
      ticketRequest.input('priority', sql.Int, 0);
    }
    if (schema.hasEstimatedWaitMinutes) {
      ticketRequest.input('estimatedWaitMinutes', sql.Int, estimatedWaitMinutes);
    }
    const waitingCountAtCreation = normalizeCustomersAhead(simulation.peopleBefore);

    if (schema.hasWaitingCountAtCreation) {
      ticketRequest.input('waitingCountAtCreation', sql.Int, waitingCountAtCreation);
    }
    if (schema.hasNotes) {
      ticketRequest.input('notes', sql.NVarChar, resolvedCustomerName || null);
    }

    const insertQuery = `
      INSERT INTO [dbo].[QueueTickets] (${columns.join(', ')})
      OUTPUT INSERTED.QueueTicketID
      VALUES (${paramNames.join(', ')});
    `;

    const insertTicketRes = await ticketRequest.query(insertQuery);
    const queueTicketId = insertTicketRes.recordset[0].QueueTicketID as number;

    try {
      for (const proId of serviceIds) {
        const svc = servicesMap.get(proId);
        await transaction
          .request()
          .input('ticketId', sql.Int, queueTicketId)
          .input('proId', sql.Int, proId)
          .input('durationMin', sql.Int, svc?.duration || defaultDur)
          .query(`
            INSERT INTO [dbo].[QueueTicketServices] (QueueTicketID, ProID, DurationMinutes)
            VALUES (@ticketId, @proId, @durationMin)
          `);
      }
    } catch (svcErr) {
      console.log('[operationsQueueCreateCore] QueueTicketServices insert skipped:', svcErr);
    }

    await transaction.commit();

    const responseEndTime = new Date(
      new Date(finalStartTime).getTime() + serviceDur * 60000,
    ).toISOString();
    const ticketNumberMatch = ticketCode.match(/-(\d+)$/);
    const ticketNumber = ticketNumberMatch ? parseInt(ticketNumberMatch[1], 10) : 0;
    const chairNumber = getChairNumber(empName);

    return {
      ok: true,
      ticketCode,
      ticketNumber,
      ticketPrefix: 'W',
      queueTicketId,
      queueDate: dateStr,
      empId,
      empName,
      chairNumber,
      customer: {
        clientId,
        name: resolvedCustomerName,
        phone: resolvedCustomerPhone,
      },
      services: serviceIds.map((id) => {
        const svc = servicesMap.get(id);
        return {
          proId: id,
          proName: svc?.name || `Service ${id}`,
          durationMinutes: svc?.duration || defaultDur,
          price: svc?.price ?? undefined,
        };
      }),
      serviceDurationMinutes: serviceDur,
      estimatedStartTime: finalStartTime,
      estimatedEndTime: responseEndTime,
      estimatedWaitMinutes,
      peopleBefore: waitingCountAtCreation,
      waitingCountAtCreation,
      status: 'waiting',
      createdAt: new Date().toISOString(),
    };
  } catch (txErr) {
    await transaction.rollback();
    if (txErr instanceof ScheduleConflictError) {
      throw new CreateOperationsQueueError(409, txErr.message, {
        code: txErr.code,
        conflict: txErr.conflict,
        reason: 'schedule_conflict',
      });
    }
    throw txErr;
  }
}

export async function resolveQuickQueueService(db: Awaited<ReturnType<typeof getPool>>) {
  const result = await db
    .request()
    .input('proId', sql.Int, QUICK_QUEUE_SERVICE_ID)
    .query(`
      SELECT TOP 1 ProID, ProName, ProNameAr, DurationMinutes, isDeleted
      FROM [dbo].[TblPro]
      WHERE ProID = @proId
    `);

  const row = result.recordset[0] as
    | {
        ProID: number;
        ProName: string;
        ProNameAr: string | null;
        DurationMinutes: number | null;
        isDeleted: boolean | number | null;
      }
    | undefined;

  if (!row || row.isDeleted === true || row.isDeleted === 1) {
    return null;
  }

  return row;
}

function formatCairoTimeLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Africa/Cairo',
  });
}

export async function executeQuickQueueOperation(): Promise<
  CreateQueueResponse | { ok: false; error: string; reason?: string; nextAvailableTime?: string }
> {
  if (!QUICK_QUEUE_ENABLED) {
    return {
      ok: false,
      error: 'إنشاء الدور السريع متوقف مؤقتاً لأسباب أمنية في الجدولة',
      reason: 'quick_queue_disabled',
    };
  }

  const db = await getPool();
  const service = await resolveQuickQueueService(db);

  if (!service) {
    console.error('[quick-queue] Configured service unavailable:', {
      serviceId: QUICK_QUEUE_SERVICE_ID,
    });
    return {
      ok: false,
      error: 'خدمة حلاقة الشعر المخصصة للدور السريع غير متاحة',
      reason: 'service_unavailable',
    };
  }

  const serviceIds = [service.ProID];
  const requestedAt = new Date().toISOString();
  const nearest = await findNearestBarberForServices(serviceIds, requestedAt);

  if (!nearest.ok || !nearest.best) {
    let error = 'لا يوجد حلاق متاح لخدمة مدتها 30 دقيقة حاليًا';
    if (nearest.nextAvailableTime) {
      error += ` — أقرب موعد متاح الساعة ${formatCairoTimeLabel(nearest.nextAvailableTime)}`;
    }
    return {
      ok: false,
      error,
      reason: 'no_available_barber',
      nextAvailableTime: nearest.nextAvailableTime ?? undefined,
    };
  }

  const simulation = await simulateQueueInsertion({
    empId: nearest.best.empId,
    serviceIds,
    requestedAt,
  });

  if (!simulation.ok) {
    return {
      ok: false,
      error: simulation.message,
      reason: 'simulation_failed',
    };
  }

  const serviceDur =
    service.DurationMinutes ??
    (await getDefaultDuration(db));
  const expectedEndTime = new Date(
    new Date(simulation.suggestedStartTime).getTime() + serviceDur * 60000,
  ).toISOString();

  try {
    const ticket = await createOperationsQueueTicket({
      empId: nearest.best.empId,
      serviceIds,
      customer: { name: QUICK_QUEUE_WALK_IN_NAME },
      expectedStartTime: simulation.suggestedStartTime,
      expectedEndTime,
      source: 'walk_in',
      trustExpectedStart: true,
    });

    return ticket;
  } catch (err) {
    if (err instanceof CreateOperationsQueueError) {
      return {
        ok: false,
        error: err.message,
        reason: String(err.payload.reason ?? 'create_failed'),
        nextAvailableTime: nearest.nextAvailableTime ?? undefined,
      };
    }
    throw err;
  }
}

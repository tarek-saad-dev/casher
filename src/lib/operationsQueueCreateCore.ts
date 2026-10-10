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
import { ScheduleConflictError } from '@/lib/scheduleIntegrity';
import type { QueuePortHooks } from '@/apps/queue/internal/queuePortAdapter';
import {
  bridgeQueueAssertEmployeeFree,
  bridgeQueueCommitOccupancy,
  bridgeQueuePublishCreatedEvent,
  bridgeQueueAcquireAnyBarberLock,
  bridgeQueueUpsertCustomer,
  BookingCreateLockError,
  type QueuePortBridgeContext,
} from '@/lib/queue/queuePortLegacyBridge';
import { hashServiceSet } from '@/lib/booking/publicBookingCreateLocks';
import { PUBLIC_BOOKING_ERROR_CATALOG } from '@/lib/booking/publicBookingErrorCatalog';
import { getBarberAvailabilityReason } from '@/lib/barberAvailability';
import { generateTicketCode } from '@/lib/queueTicketCode';
import { detectQueueTicketsSchema, buildInsertColumns } from '@/lib/queueSchema';
import { getChairNumber } from '@/lib/chairMapping';
import { calculateServicePlanDuration, buildSequentialServicePlanFromLines } from '@/lib/servicePlan';
import { findNearestBarberForServices } from '@/lib/queueNearestBarber';
import {
  QUICK_QUEUE_SERVICE_ID,
  QUICK_QUEUE_WALK_IN_NAME,
  QUICK_QUEUE_ENABLED,
} from '@/lib/quickQueueConfig';
import type { CreateQueueResponse } from '@/lib/operationsQueueTypes';
import { resolveLegacyBranchTenantId } from '@/platform/masterData/tenantScope';

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
  source: 'walk_in' | 'booking' | 'reschedule' | 'operations_barber_header';
  /** When true, skip the 5-minute client/simulation drift check (server-orchestrated flows). */
  trustExpectedStart?: boolean;
  /** When true, commit expectedStartTime/End from client after transactional validation (barber-header flow). */
  useClientPlannedTimes?: boolean;
  /** Branch owning this ticket — stamped on write, scopes ticket numbering. */
  branchId: number;
  queuePortHooks?: QueuePortHooks;
  useExtractedEventDelivery?: boolean;
  /**
   * Already-begun transaction. Used so any-barber applock and ticket insert
   * commit together. This function does not begin, commit, or roll it back.
   */
  joinTransaction?: sql.Transaction;
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

/** QueueTickets.Source is NVARCHAR(20) — map long API sources to short persisted values. */
export function persistQueueTicketSource(
  source: CreateOperationsQueueInput['source'] | string,
): string {
  if (source === 'operations_barber_header') return 'ops_header';
  const s = String(source || 'walk_in');
  return s.length <= 20 ? s : s.slice(0, 20);
}

function notifyQueueTicketCreated(input: {
  employeeId: number;
  businessDate: string;
  branchId: number;
}): void {
  void import('@/lib/booking/cache/hotCacheInvalidateBestEffort')
    .then((m) =>
      m.notifyHotQueueChanged({
        employeeId: input.employeeId,
        businessDate: input.businessDate,
        branchId: input.branchId,
        reason: 'queue_ticket_created',
      }),
    )
    .catch(() => undefined);
}

/** Port path: customer identity goes through Customers.upsertByPhone. */
export async function assignQueueCustomerThroughPort(
  portCtx: QueuePortBridgeContext,
  transaction: sql.Transaction,
  customer: { name?: string; phone: string },
  branchId = 0,
): Promise<{ clientId: number; name: string | null; phone: string }> {
  if (!portCtx.queuePortHooks) {
    throw new Error('QUEUE_CUSTOMER_PORT_REQUIRED');
  }
  const phone = customer.phone.trim();
  const displayName = customer.name?.trim() || phone;
  const clientId = await bridgeQueueUpsertCustomer(
    portCtx,
    transaction,
    displayName,
    phone,
    branchId,
  );
  return {
    clientId,
    name: customer.name?.trim() || displayName,
    phone,
  };
}

export async function createOperationsQueueTicket(
  input: CreateOperationsQueueInput,
): Promise<CreateQueueResponse> {
  const db = await getPool();
  const {
    empId,
    serviceIds,
    customer,
    expectedStartTime,
    expectedEndTime,
    source,
    trustExpectedStart = false,
    useClientPlannedTimes = false,
    branchId,
    queuePortHooks,
    useExtractedEventDelivery,
    joinTransaction,
  } = input;
  const ownsTransaction = !joinTransaction;
  const transaction = joinTransaction ?? new sql.Transaction(db);

  const portCtx: QueuePortBridgeContext = { queuePortHooks };

  if (!empId || typeof empId !== 'number') {
    throw new CreateOperationsQueueError(400, 'empId مطلوب');
  }

  if (!branchId || typeof branchId !== 'number') {
    throw new CreateOperationsQueueError(400, 'branchId مطلوب');
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

  {
    const { isEmployeeEligibleForBranchBookings } = await import(
      '@/lib/branch/bookingQueueOwnership'
    );
    const operationalDate = getCairoBusinessDate();
    const assigned = await isEmployeeEligibleForBranchBookings({
      empId,
      branchId,
      operationalDate,
      requireCanReceiveBookings: false,
      includeTemporaryTransfer: true,
    });
    if (!assigned) {
      throw new CreateOperationsQueueError(
        400,
        'الموظف غير معيَّن على هذا الفرع',
        { reason: 'emp_not_assigned' },
      );
    }
  }

  const availGuard = await getBarberAvailabilityReason(empId, new Date());
  if (!availGuard.available) {
    throw new CreateOperationsQueueError(409, availGuard.reason ?? 'الحلاق غير متاح', {
      reason: 'barber_unavailable',
    });
  }

  const defaultDur = await getDefaultDuration(db);
  let servicePlan;
  try {
    servicePlan = await calculateServicePlanDuration(serviceIds);
  } catch (planErr) {
    throw new CreateOperationsQueueError(
      400,
      planErr instanceof Error ? planErr.message : 'خطأ في الخدمات المختارة',
    );
  }
  const serviceDur = servicePlan.totalDurationMinutes;

  const simulation = useClientPlannedTimes
    ? null
    : await simulateQueueInsertion({
        empId,
        serviceIds,
        requestedAt: new Date().toISOString(),
        branchId,
      });

  if (!useClientPlannedTimes) {
    if (!simulation!.ok) {
      throw new CreateOperationsQueueError(409, simulation!.message, {
        newSuggestion: simulation,
      });
    }
  }

  const now = new Date();
  const operationalDate = getCairoBusinessDate(now);
  const checkDateStr = operationalDate;

  let finalStartTime: string;
  let finalStartDate: Date;
  let finalEndDate: Date;
  let waitingCountAtCreation: number;

  if (useClientPlannedTimes) {
    finalStartDate = new Date(expectedStartTime);
    finalEndDate = new Date(expectedEndTime);
    const plannedDur = Math.round((finalEndDate.getTime() - finalStartDate.getTime()) / 60000);
    if (plannedDur !== serviceDur) {
      throw new CreateOperationsQueueError(
        400,
        `مدة الموعد (${plannedDur} د) لا تطابق الخدمات المختارة (${serviceDur} د)`,
      );
    }
    finalStartTime = finalStartDate.toISOString();
    const simForCount = await simulateQueueInsertion({
      empId,
      serviceIds,
      requestedAt: finalStartTime,
      branchId,
    });
    waitingCountAtCreation = simForCount.ok ? simForCount.peopleBefore : 0;
  } else {
    const suggestedStartTime = new Date(simulation!.suggestedStartTime);
    const suggestedEndTime = new Date(suggestedStartTime.getTime() + serviceDur * 60000);

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
      const suggestedStart = new Date(simulation!.suggestedStartTime).getTime();
      const timeDiffMinutes = Math.abs(requestedStart - suggestedStart) / 60000;

      if (timeDiffMinutes > 5) {
        throw new CreateOperationsQueueError(409, 'الوقت المطلوب لم يعد متاحاً، تم تحديث الجدول', {
          newSuggestion: simulation,
          reason: `الوقت المقترح الآن: ${simulation!.suggestedStartTime}`,
        });
      }
    }

    finalStartTime = simulation!.suggestedStartTime;
    finalStartDate = new Date(finalStartTime);
    waitingCountAtCreation = normalizeCustomersAhead(simulation!.peopleBefore);
    finalEndDate = new Date(finalStartDate.getTime() + serviceDur * 60000);
  }

  const dateStr = operationalDate;
  const sequentialPlan = buildSequentialServicePlanFromLines({
    lines: servicePlan.services,
    startAt: finalStartDate,
    empId,
  });
  if (!useClientPlannedTimes) {
    finalEndDate = new Date(sequentialPlan.endAt);
  }

  const ticketCode = await generateTicketCode(db, dateStr, 'W', branchId);

  const schema = await detectQueueTicketsSchema();
  const nowMs = new Date().getTime();
  const startMs = new Date(finalStartTime).getTime();
  const estimatedWaitMinutes = Math.max(0, Math.round((startMs - nowMs) / 60000));
  const { columns, paramNames } = buildInsertColumns(schema, branchId);

  if (ownsTransaction) {
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  }

  try {
    await bridgeQueueAssertEmployeeFree(portCtx, transaction, {
      employeeId: empId,
      startMs: finalStartDate.getTime(),
      endMs: finalEndDate.getTime(),
      operationalDate: dateStr,
      branchId,
    });

    let clientId: number | null = null;
    let resolvedCustomerName = customer?.name || null;
    let resolvedCustomerPhone = customer?.phone || null;

    if (customer?.clientId && schema.hasClientID) {
      const clientTenantId = await resolveLegacyBranchTenantId(branchId, transaction);
      const owned = await transaction
        .request()
        .input('clientId', sql.Int, customer.clientId)
        .input('tenantId', sql.UniqueIdentifier, clientTenantId)
        .query(`SELECT 1 AS ok FROM [dbo].[TblClient] WHERE ClientID = @clientId AND TenantId = @tenantId`);
      if (owned.recordset.length === 0) {
        throw new CreateOperationsQueueError(404, 'العميل غير موجود');
      }
      clientId = customer.clientId;
    } else if (customer?.phone?.trim() && portCtx.queuePortHooks) {
      const assigned = await assignQueueCustomerThroughPort(
        portCtx,
        transaction,
        {
          name: customer.name,
          phone: customer.phone,
        },
        branchId,
      );
      clientId = assigned.clientId;
      resolvedCustomerName = assigned.name;
      resolvedCustomerPhone = assigned.phone;
    } else if (customer?.phone) {
      try {
        const clientTenantId = await resolveLegacyBranchTenantId(branchId, transaction);
        const findClient = await transaction
          .request()
          .input('phone', sql.NVarChar, customer.phone)
          .input('tenantId', sql.UniqueIdentifier, clientTenantId)
          .query(`
            SELECT TOP 1 ClientID, Name, Mobile
            FROM [dbo].[TblClient]
            WHERE TenantId = @tenantId AND (Mobile = @phone OR Mobile2 = @phone)
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
            .input('tenantId', sql.UniqueIdentifier, clientTenantId)
            .query(`
              INSERT INTO [dbo].[TblClient] (TenantId, Name, Mobile)
              OUTPUT INSERTED.ClientID
              VALUES (@tenantId, @name, @phone);
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
      .input('source', sql.NVarChar, persistQueueTicketSource(source))
      .input('estimatedStartTime', sql.DateTime, new Date(finalStartTime));

    if (schema.hasBranchID) {
      ticketRequest.input('branchId', sql.Int, branchId);
    }
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
    const waitingCountAtCreationNorm = normalizeCustomersAhead(waitingCountAtCreation);

    if (schema.hasWaitingCountAtCreation) {
      ticketRequest.input('waitingCountAtCreation', sql.Int, waitingCountAtCreationNorm);
    }
    if (schema.hasDurationMinutes) {
      ticketRequest.input('durationMinutes', sql.Int, serviceDur);
    }
    if (schema.hasExpectedStartAt) {
      ticketRequest.input('expectedStartAt', sql.DateTime, finalStartDate);
    }
    if (schema.hasExpectedEndAt) {
      ticketRequest.input('expectedEndAt', sql.DateTime, finalEndDate);
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
      for (const line of servicePlan.services) {
        await transaction
          .request()
          .input('ticketId', sql.Int, queueTicketId)
          .input('proId', sql.Int, line.serviceId)
          .input('proName', sql.NVarChar, line.serviceName)
          .input('durationMin', sql.Int, line.durationMinutes)
          .input('price', sql.Decimal, line.price)
          .query(`
            INSERT INTO [dbo].[QueueTicketServices]
              (QueueTicketID, ProID, ProName, DurationMinutes, Price, Qty)
            VALUES (@ticketId, @proId, @proName, @durationMin, @price, 1)
          `);
      }
    } catch (svcErr) {
      try {
        for (const line of servicePlan.services) {
          await transaction
            .request()
            .input('ticketId', sql.Int, queueTicketId)
            .input('proId', sql.Int, line.serviceId)
            .input('durationMin', sql.Int, line.durationMinutes)
            .query(`
              INSERT INTO [dbo].[QueueTicketServices] (QueueTicketID, ProID, DurationMinutes)
              VALUES (@ticketId, @proId, @durationMin)
            `);
        }
      } catch (svcErr2) {
        console.log('[operationsQueueCreateCore] QueueTicketServices insert skipped:', svcErr2);
      }
    }

    if (useExtractedEventDelivery) {
      await bridgeQueueCommitOccupancy(portCtx, transaction, {
        employeeId: empId,
        startMs: finalStartDate.getTime(),
        endMs: finalEndDate.getTime(),
        queueTicketId,
        locationId: branchId,
      });
      await bridgeQueuePublishCreatedEvent(portCtx, transaction, {
        queueTicketId,
        ticketCode,
        branchId,
        empId,
      });
    }

    if (ownsTransaction) {
      await transaction.commit();
      notifyQueueTicketCreated({
        employeeId: empId,
        businessDate: dateStr,
        branchId,
      });
    }

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
      services: servicePlan.services.map((line) => ({
        proId: line.serviceId,
        proName: line.serviceName,
        durationMinutes: line.durationMinutes,
        price: line.price,
      })),
      serviceDurationMinutes: serviceDur,
      estimatedStartTime: finalStartTime,
      estimatedEndTime: sequentialPlan.endAt,
      estimatedWaitMinutes,
      peopleBefore: waitingCountAtCreationNorm,
      waitingCountAtCreation: waitingCountAtCreationNorm,
      status: 'waiting',
      createdAt: new Date().toISOString(),
    };
  } catch (txErr) {
    if (ownsTransaction) {
      await transaction.rollback();
    }
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

type QuickQueueFailure = {
  ok: false;
  error: string;
  reason?: string;
  nextAvailableTime?: string;
};

type QuickQueuePlan = {
  ok: true;
  empId: number;
  expectedStartTime: string;
  expectedEndTime: string;
  startMs: number;
  endMs: number;
  nextAvailableTime?: string;
};

function lockTimeoutFailure(): QuickQueueFailure {
  return {
    ok: false,
    error: PUBLIC_BOOKING_ERROR_CATALOG.BOOKING_LOCK_TIMEOUT.messageAr,
    reason: 'lock_timeout',
  };
}

async function planQuickQueueAssignment(
  branchId: number,
  serviceIds: number[],
  requestedAt: string,
  serviceDurMinutes: number,
): Promise<QuickQueuePlan | QuickQueueFailure> {
  const nearest = await findNearestBarberForServices(serviceIds, requestedAt, branchId);
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
    branchId,
  });
  if (!simulation.ok) {
    return {
      ok: false,
      error: simulation.message,
      reason: 'simulation_failed',
    };
  }

  const expectedStartTime = simulation.suggestedStartTime;
  const expectedEndTime = new Date(
    new Date(expectedStartTime).getTime() + serviceDurMinutes * 60000,
  ).toISOString();
  return {
    ok: true,
    empId: nearest.best.empId,
    expectedStartTime,
    expectedEndTime,
    startMs: new Date(expectedStartTime).getTime(),
    endMs: new Date(expectedEndTime).getTime(),
    nextAvailableTime: nearest.nextAvailableTime ?? undefined,
  };
}

function quickQueueCreateFailure(
  err: CreateOperationsQueueError,
  nextAvailableTime?: string,
): QuickQueueFailure {
  return {
    ok: false,
    error: err.message,
    reason: String(err.payload.reason ?? 'create_failed'),
    nextAvailableTime,
  };
}

export async function executeQuickQueueOperation(
  branchId: number,
  options?: { queuePortHooks?: QueuePortHooks; useExtractedEventDelivery?: boolean },
): Promise<CreateQueueResponse | QuickQueueFailure> {
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

  if (!options?.queuePortHooks) {
    const serviceDur = service.DurationMinutes ?? (await getDefaultDuration(db));
    const plan = await planQuickQueueAssignment(branchId, serviceIds, requestedAt, serviceDur);
    if (!plan.ok) return plan;
    try {
      return await createOperationsQueueTicket({
        empId: plan.empId,
        serviceIds,
        customer: { name: QUICK_QUEUE_WALK_IN_NAME },
        expectedStartTime: plan.expectedStartTime,
        expectedEndTime: plan.expectedEndTime,
        source: 'walk_in',
        trustExpectedStart: true,
        branchId,
      });
    } catch (err) {
      if (err instanceof CreateOperationsQueueError) {
        return quickQueueCreateFailure(err, plan.nextAvailableTime);
      }
      throw err;
    }
  }

  let serviceDur: number;
  try {
    const servicePlan = await calculateServicePlanDuration(serviceIds);
    serviceDur = servicePlan.totalDurationMinutes;
  } catch (planErr) {
    return {
      ok: false,
      error: planErr instanceof Error ? planErr.message : 'خطأ في الخدمات المختارة',
      reason: 'service_unavailable',
    };
  }
  let plan = await planQuickQueueAssignment(branchId, serviceIds, requestedAt, serviceDur);
  if (!plan.ok) return plan;

  // Same slot key Booking uses (hashServiceSet), so the tenant any-barber applock matches.
  // Discover the interval, lock it, then select again while the lock is held.
  // If the interval moves, roll back before taking a different any-barber lock.
  const slotKey = hashServiceSet(serviceIds);
  for (let attempt = 0; attempt < 3; attempt++) {
    const tx = new sql.Transaction(db);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      await bridgeQueueAcquireAnyBarberLock(
        { queuePortHooks: options.queuePortHooks },
        tx,
        branchId,
        plan.startMs,
        plan.endMs,
        slotKey,
      );
      const locked = await planQuickQueueAssignment(
        branchId,
        serviceIds,
        requestedAt,
        serviceDur,
      );
      if (!locked.ok) {
        await tx.rollback();
        return locked;
      }
      if (locked.startMs !== plan.startMs || locked.endMs !== plan.endMs) {
        await tx.rollback();
        plan = locked;
        continue;
      }
      const ticket = await createOperationsQueueTicket({
        empId: locked.empId,
        serviceIds,
        customer: { name: QUICK_QUEUE_WALK_IN_NAME },
        expectedStartTime: locked.expectedStartTime,
        expectedEndTime: locked.expectedEndTime,
        source: 'walk_in',
        trustExpectedStart: true,
        useClientPlannedTimes: true,
        branchId,
        queuePortHooks: options.queuePortHooks,
        useExtractedEventDelivery: options.useExtractedEventDelivery,
        joinTransaction: tx,
      });
      await tx.commit();
      notifyQueueTicketCreated({
        employeeId: locked.empId,
        businessDate: getCairoBusinessDate(),
        branchId,
      });
      return ticket;
    } catch (err) {
      try {
        await tx.rollback();
      } catch {
        /* transaction already closed */
      }
      if (err instanceof CreateOperationsQueueError) {
        return quickQueueCreateFailure(err, plan.nextAvailableTime);
      }
      if (err instanceof BookingCreateLockError) {
        return lockTimeoutFailure();
      }
      throw err;
    }
  }

  return lockTimeoutFailure();
}

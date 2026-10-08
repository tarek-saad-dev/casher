import {
  drvowaIntegrationErrorResponse,
  requireDrvowaIntegrationAuth,
} from '@/lib/integrations/drvowaAuth';
import {
  getPublicBookingByCode,
  listPublicUpcomingBookings,
} from '@/lib/booking/publicBookingReader';
import { buildPublicAvailabilityMatrix } from '@/lib/booking/v2Frontend/buildAvailabilityMatrix';
import {
  evaluatePublicBookingSelection,
} from '@/lib/booking/publicBookingSelectionEvaluator';
import { createPublicBooking } from '@/lib/booking/publicBookingCreate';
import { cancelPublicBooking } from '@/lib/booking/publicBookingCancellation';
import { reschedulePublicBooking } from '@/lib/booking/publicBookingReschedule';

export const runtime = 'nodejs';

type Context = { params: Promise<{ tool: string }> };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
}

function safeError(error: unknown): { code: string; message: string } {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code?: unknown }).code ?? 'ERP_TOOL_FAILED');
    return { code, message: code };
  }
  if (error instanceof Error) {
    return {
      code: error.message.slice(0, 128) || 'ERP_TOOL_FAILED',
      message: 'ERP tool failed',
    };
  }
  return { code: 'ERP_TOOL_FAILED', message: 'ERP tool failed' };
}

function ok(tool: string, data: unknown): Response {
  return Response.json({ ok: true, tool, data });
}

function fail(tool: string, error: unknown, status = 400): Response {
  return Response.json(
    { ok: false, tool, error: safeError(error) },
    { status },
  );
}

export async function POST(request: Request, context: Context) {
  let tool = '';
  try {
    await requireDrvowaIntegrationAuth(request);
    tool = (await context.params).tool;
    const body = record(await request.json().catch(() => ({})));
    const input = record(body.input);
    const requestId = stringValue(body.requestId) || crypto.randomUUID();

    if (tool === 'booking.get_upcoming') {
      const result = await listPublicUpcomingBookings({
        phone: input.phone,
        fromDate: input.fromDate,
        limit: input.limit,
      });
      return ok(tool, result);
    }

    if (tool === 'booking.get_by_code') {
      const result = await getPublicBookingByCode({
        code: stringValue(input.code),
        phone: stringValue(input.phone),
      });
      return ok(tool, {
        booking: result.booking,
        ownership: result.ownership,
      });
    }

    if (tool === 'booking.get_availability') {
      const result = await buildPublicAvailabilityMatrix({
        branchCode: stringValue(input.branchCode) || undefined,
        branchCodes: Array.isArray(input.branchCodes)
          ? input.branchCodes.map(String)
          : undefined,
        fromBusinessDate: stringValue(input.fromBusinessDate),
        toBusinessDate:
          stringValue(input.toBusinessDate)
          || stringValue(input.fromBusinessDate),
        serviceIds: numberArray(input.serviceIds),
        employeeId:
          Number.isInteger(Number(input.employeeId)) && Number(input.employeeId) > 0
            ? Number(input.employeeId)
            : undefined,
        employeeIds: numberArray(input.employeeIds),
        durationMinutes:
          Number.isFinite(Number(input.durationMinutes)) && Number(input.durationMinutes) > 0
            ? Number(input.durationMinutes)
            : undefined,
      });
      return ok(tool, result.body);
    }

    if (tool === 'booking.plan') {
      const evaluation = await evaluatePublicBookingSelection({
        branchCode: stringValue(input.branchCode) || null,
        date: stringValue(input.date) || null,
        time: stringValue(input.time) || null,
        dayOffset: input.dayOffset,
        serviceIds: input.serviceIds,
        packageId: input.packageId,
        addonProIds: input.addonProIds,
        empId: input.empId,
        mode: input.mode,
        purpose: 'plan',
      });
      if (!evaluation.available) {
        return fail(
          tool,
          { code: evaluation.availabilityCode ?? 'BOOKING_PLAN_UNAVAILABLE' },
          409,
        );
      }
      return ok(tool, {
        branch: {
          branchCode: evaluation.branchContext.branchCode,
          branchName: evaluation.branchContext.branchName,
        },
        mode: evaluation.mode,
        assignmentStrategy: evaluation.assignmentStrategy,
        barber: evaluation.specificBarber,
        candidateBarbers: evaluation.candidateBarbers,
        date: evaluation.workDate,
        time: evaluation.requestedTime,
        dayOffset: evaluation.requestedDayOffset,
        startDateTime: evaluation.startDateTime,
        endDateTime: evaluation.endDateTime,
        services: evaluation.selectedServices,
        totalDurationMinutes: evaluation.totalDurationMinutes,
        total: evaluation.subtotal,
        currency: 'EGP',
        planToken: evaluation.planToken,
        planExpiresAt: evaluation.planExpiresAt,
      });
    }

    if (tool === 'booking.create') {
      const customer = record(input.customer);
      const result = await createPublicBooking({
        branchCode: stringValue(input.branchCode) || null,
        date: stringValue(input.date) || null,
        time: stringValue(input.time) || null,
        dayOffset: input.dayOffset,
        serviceIds: input.serviceIds,
        packageId: input.packageId,
        addonProIds: input.addonProIds,
        empId: input.empId,
        mode: input.mode,
        planToken: stringValue(input.planToken) || null,
        customer: {
          name: stringValue(customer.name),
          phone: stringValue(customer.phone),
        },
        notes: stringValue(input.notes) || null,
        clientRequestId: stringValue(input.idempotencyKey) || requestId,
        idempotencyKeyHeader: stringValue(input.idempotencyKey) || requestId,
        suppressNotification: true,
        bookingSource: 'online',
      });
      return ok(tool, result.body);
    }

    if (tool === 'booking.cancel') {
      const result = await cancelPublicBooking({
        code: stringValue(input.code),
        phone: stringValue(input.phone),
        reasonCode: stringValue(input.reasonCode) || null,
        reasonText: stringValue(input.reasonText) || null,
        clientRequestId: stringValue(input.idempotencyKey) || requestId,
        idempotencyKey: stringValue(input.idempotencyKey) || requestId,
      });
      return ok(tool, result.body);
    }

    if (tool === 'booking.reschedule') {
      const desired = record(input.desired);
      const result = await reschedulePublicBooking({
        code: stringValue(input.code),
        phone: stringValue(input.phone),
        desired: {
          workDate: stringValue(desired.workDate),
          time: stringValue(desired.time),
          empId: Number(desired.empId),
          branchCode: stringValue(desired.branchCode),
          serviceIds: numberArray(desired.serviceIds),
        },
        idempotencyKey: stringValue(input.idempotencyKey) || requestId,
        suppressCustomerWhatsApp: true,
      });
      return ok(tool, result);
    }

    return Response.json(
      {
        ok: false,
        tool,
        error: { code: 'TOOL_NOT_FOUND', message: 'Tool not found' },
      },
      { status: 404 },
    );
  } catch (error) {
    if (
      error instanceof Error
      && (
        error.message === 'DRVOWA_INTEGRATION_UNAUTHORIZED'
        || error.message === 'DRVOWA_INTEGRATION_NOT_CONFIGURED'
      )
    ) {
      return drvowaIntegrationErrorResponse(error);
    }
    console.error('[drvowa-integration-tool]', {
      tool,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return fail(tool || 'unknown', error, 400);
  }
}

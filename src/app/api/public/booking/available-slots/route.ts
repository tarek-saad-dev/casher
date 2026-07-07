import { NextRequest, NextResponse } from 'next/server';
import {
  getRateLimitKey,
  checkRateLimit,
  isValidDate,
  PUBLIC_CORS_HEADERS,
} from '@/lib/publicBookingHelpers';
import { listAvailableBookingSlots } from '@/lib/bookingAvailabilityEngine';
import { ServicePlanError } from '@/lib/servicePlan';

export const runtime = 'nodejs';

export type DurationSource =
  | 'EMP_SERVICE_OVERRIDE'
  | 'SERVICE_DEFAULT'
  | 'SYSTEM_DEFAULT'
  | 'HARDCODED_FALLBACK';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

/**
 * GET /api/public/booking/available-slots
 *
 * Delegates to listAvailableBookingSlots — canonical engine shared with
 * operations timeline (buildQueueIntervals + buildBookingIntervals).
 */
export async function GET(req: NextRequest) {
  const ip = getRateLimitKey(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'طلبات كثيرة' },
      { status: 429, headers: PUBLIC_CORS_HEADERS },
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date') ?? '';
    const serviceParam = searchParams.get('serviceIds') ?? '';
    const mode = (searchParams.get('mode') ?? 'nearest') as 'nearest' | 'specific';
    const empIdParam = searchParams.get('empId');
    const source = (searchParams.get('source') ?? 'public') as
      | 'public'
      | 'operations'
      | 'admin';

    if (!date || !isValidDate(date)) {
      return NextResponse.json(
        { error: 'تاريخ غير صالح' },
        { status: 400, headers: PUBLIC_CORS_HEADERS },
      );
    }

    const serviceIds = serviceParam
      ? serviceParam.split(',').map(Number).filter((n) => n > 0)
      : [];
    const empId = empIdParam ? Number(empIdParam) : null;

    if (mode === 'specific' && !empId) {
      return NextResponse.json(
        { error: 'empId مطلوب في وضع specific' },
        { status: 400, headers: PUBLIC_CORS_HEADERS },
      );
    }

    const result = await listAvailableBookingSlots({
      date,
      serviceIds,
      mode,
      empId,
      source,
    });

    const slots = result.availableSlots.map((s) => ({
      time: s.time,
      endTime: s.endTime,
      label: s.label,
      available: true,
      dayOffset: s.dayOffset,
      empId: s.empId,
      barberName: s.empName,
      durationMinutes: s.durationMinutes,
      durationSource: result.durationSource as DurationSource,
      startAt: s.startAt,
      endAt: s.endAt,
    }));

    return NextResponse.json(
      {
        ok: true,
        date: result.date,
        mode: result.mode,
        serviceDurationMinutes: result.durationMinutes,
        durationSource: result.durationSource,
        ...(result.empId ? { empId: result.empId } : {}),
        slots,
        availableSlots: slots,
        noSlotsReason: result.noSlotsReason,
        gapNotice: result.gapNotice,
        nextAvailable: result.nextAvailable,
        alternativeBarbers: result.alternativeBarbers,
        debug: {
          ...result.debug,
          noSlotsReason: result.noSlotsReason,
          gapNotice: result.gapNotice,
          nextAvailable: result.nextAvailable?.time ?? null,
          alternativeBarbers: result.alternativeBarbers,
        },
      },
      { headers: PUBLIC_CORS_HEADERS },
    );
  } catch (err) {
    if (err instanceof ServicePlanError) {
      return NextResponse.json(
        { ok: false, code: err.code, message: err.message },
        { status: err.status, headers: PUBLIC_CORS_HEADERS },
      );
    }
    console.error('[public/booking/available-slots]', err);
    return NextResponse.json(
      { error: 'فشل تحميل المواعيد' },
      { status: 500, headers: PUBLIC_CORS_HEADERS },
    );
  }
}

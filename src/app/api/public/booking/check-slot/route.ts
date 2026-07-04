import { NextRequest, NextResponse } from 'next/server';
import {
  getRateLimitKey,
  checkRateLimit,
  isValidDate,
  isValidTime,
  PUBLIC_CORS_HEADERS,
} from '@/lib/publicBookingHelpers';
import {
  validateBookingSlot,
  BOOKING_SLOT_REASON_AR,
  type BookingSlotReasonCode,
} from '@/lib/bookingAvailabilityEngine';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

/**
 * POST /api/public/booking/check-slot
 *
 * Body:
 *   { date, time, serviceIds, mode, empId?, source? }
 *
 * Returns availability for the requested slot using the canonical engine.
 * For nearest mode, picks the first available barber.
 */
export async function POST(req: NextRequest) {
  const ip = getRateLimitKey(req);
  if (!checkRateLimit(ip, 120)) {
    return NextResponse.json({ error: 'طلبات كثيرة' }, { status: 429, headers: PUBLIC_CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const {
      date,
      time,
      serviceIds = [],
      mode       = 'nearest',
      empId,
      source     = 'public',
    } = body as {
      date:        string;
      time:        string;
      serviceIds?: number[];
      mode?:       'nearest' | 'specific';
      empId?:      number;
      source?:     'public' | 'operations' | 'admin';
    };

    if (!date || !isValidDate(date)) {
      return NextResponse.json({ error: 'تاريخ غير صالح' }, { status: 400, headers: PUBLIC_CORS_HEADERS });
    }
    if (!time || !isValidTime(time)) {
      return NextResponse.json({ error: 'وقت غير صالح' }, { status: 400, headers: PUBLIC_CORS_HEADERS });
    }
    if (mode === 'specific' && !empId) {
      return NextResponse.json({ error: 'empId مطلوب في وضع specific' }, { status: 400, headers: PUBLIC_CORS_HEADERS });
    }

    const validation = await validateBookingSlot({
      date,
      time,
      serviceIds,
      mode,
      empId,
      source,
    });

    const plan = validation.plan;
    const reasonCode: BookingSlotReasonCode = validation.reasonCode ?? 'booking_conflict';

    if (validation.available && plan) {
      return NextResponse.json({
        ok:        true,
        available: true,
        barber:    { id: plan.empId, name: plan.empName },
        slot: {
          start:           plan.startAt,
          end:             plan.endAt,
          durationMinutes: plan.durationMinutes,
        },
      }, { headers: PUBLIC_CORS_HEADERS });
    }

    return NextResponse.json({
      ok:           false,
      available:    false,
      reason:       validation.reasonMessage ?? BOOKING_SLOT_REASON_AR[reasonCode],
      reasonCode,
      conflictType: reasonCode === 'queue_conflict' ? 'queue' : 'booking',
      nextAvailableTime: validation.nextAvailable?.startAt ?? null,
    }, { status: 200, headers: PUBLIC_CORS_HEADERS });
  } catch (err) {
    console.error('[public/booking/check-slot]', err);
    return NextResponse.json({ error: 'فشل التحقق من الموعد' }, { status: 500, headers: PUBLIC_CORS_HEADERS });
  }
}

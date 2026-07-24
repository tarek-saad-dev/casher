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
import {
  extractPublicBranchCode,
  resolvePublicBranchCode,
  publicBranchRequiredResponse,
  publicInvalidBranchResponse,
} from '@/lib/branch/bookingQueueOwnership';
import { BranchDomainError } from '@/lib/branch/types';
import { requireActiveBranchContext, isActiveBranchContext } from '@/lib/branch/context';

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
      dayOffset  = 0,
      source     = 'public',
    } = body as {
      date:        string;
      time:        string;
      serviceIds?: number[];
      mode?:       'nearest' | 'specific';
      empId?:      number;
      dayOffset?:  0 | 1;
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

    // Resolve branch: internal callers use the authenticated session branch;
    // public callers must supply branchCode (never a silent default).
    const { searchParams } = new URL(req.url);
    const isInternalSource = source === 'operations' || source === 'admin';
    let branchId: number;
    if (isInternalSource) {
      const branchCtx = await requireActiveBranchContext();
      if (!isActiveBranchContext(branchCtx)) return branchCtx;
      branchId = branchCtx.branchId;
    } else {
      const branchCode = extractPublicBranchCode(searchParams, body);
      try {
        const branch = await resolvePublicBranchCode(branchCode, {
          route: '/api/public/booking/check-slot',
        });
        branchId = branch.branchId;
      } catch (err) {
        if (err instanceof BranchDomainError) {
          return err.code === 'BRANCH_REQUIRED'
            ? publicBranchRequiredResponse()
            : publicInvalidBranchResponse();
        }
        throw err;
      }
    }

    const validation = await validateBookingSlot({
      date,
      time,
      dayOffset,
      serviceIds,
      mode,
      empId,
      source,
      branchId,
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

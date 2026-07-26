import { NextRequest, NextResponse } from 'next/server';
import {
  getRateLimitKey,
  checkRateLimit,
  isValidDate,
  PUBLIC_CORS_HEADERS,
} from '@/lib/publicBookingHelpers';
import {
  extractPublicBranchCode,
  resolvePublicBranchCode,
  publicBranchRequiredResponse,
  publicInvalidBranchResponse,
} from '@/lib/branch/bookingQueueOwnership';
import { BranchDomainError } from '@/lib/branch/types';
import { listAvailableBookingSlots } from '@/lib/bookingAvailabilityEngine';
import { resolveEmployeeBranchSchedule } from '@/lib/hr/employeeBranchScheduleResolver';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

/**
 * GET /api/public/booking/barbers/[empId]/available-slots
 * Required: date, branchCode, serviceIds
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ empId: string }> },
) {
  const ip = getRateLimitKey(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'طلبات كثيرة' }, { status: 429, headers: PUBLIC_CORS_HEADERS });
  }

  try {
    const { empId: empIdRaw } = await ctx.params;
    const empId = Number(empIdRaw);
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date') || '';
    const branchCode = extractPublicBranchCode(searchParams);
    const serviceIds = (searchParams.get('serviceIds') || '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);

    if (!Number.isFinite(empId) || empId <= 0 || !isValidDate(date) || !serviceIds.length) {
      return NextResponse.json(
        { error: 'date + branchCode + serviceIds مطلوبة' },
        { status: 400, headers: PUBLIC_CORS_HEADERS },
      );
    }

    let branch;
    try {
      branch = await resolvePublicBranchCode(branchCode, {
        route: '/api/public/booking/barbers/available-slots',
      });
    } catch (err) {
      if (err instanceof BranchDomainError) {
        return err.code === 'BRANCH_REQUIRED'
          ? publicBranchRequiredResponse()
          : publicInvalidBranchResponse();
      }
      throw err;
    }

    const schedule = await resolveEmployeeBranchSchedule({
      empId,
      branchId: branch.branchId,
      workDate: date,
    });
    if (!schedule?.isWorking) {
      // Check if available at a different public branch
      const { resolveEmployeeGlobalSchedule } = await import(
        '@/lib/hr/employeeBranchScheduleResolver'
      );
      const global = await resolveEmployeeGlobalSchedule({
        empId,
        workDate: date,
        publicOnly: true,
      });
      if (global.branches[0]) {
        return NextResponse.json(
          {
            ok: false,
            code: 'BARBER_AVAILABLE_AT_DIFFERENT_BRANCH',
            availableBranch: {
              branchCode: global.branches[0].branchCode,
              branchName: global.branches[0].branchName,
            },
          },
          { status: 409, headers: PUBLIC_CORS_HEADERS },
        );
      }
      return NextResponse.json(
        { ok: true, date, branchCode: branch.branchCode, empId, slots: [] },
        { headers: PUBLIC_CORS_HEADERS },
      );
    }

    const result = await listAvailableBookingSlots({
      date,
      serviceIds,
      mode: 'specific',
      empId,
      branchId: branch.branchId,
      source: 'public',
    });

    return NextResponse.json(
      {
        ok: true,
        date,
        branchCode: branch.branchCode,
        empId,
        slots: result.slots
          .filter((s) => s.available)
          .map((s) => ({ time: s.time, dayOffset: s.dayOffset })),
      },
      { headers: PUBLIC_CORS_HEADERS },
    );
  } catch (err) {
    console.error('[public/booking/barbers/available-slots]', err);
    return NextResponse.json({ error: 'فشل تحميل المواعيد' }, { status: 500, headers: PUBLIC_CORS_HEADERS });
  }
}

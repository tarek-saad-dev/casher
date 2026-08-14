/**
 * POST /api/operations/queue/plan-for-barber
 *
 * Plans earliest available queue slot for a fixed barber and service set.
 * Optional body.branchId targets the barber's operational branch across sessions.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  planQueueForBarber,
  QueuePlanForBarberError,
} from '@/lib/operationsQueuePlanCore';
import { requireBranchOperationAccess, isActiveBranchContext } from '@/lib/branch/context';
import {
  opsWriteBranchErrorResponse,
  resolveOpsWriteBranch,
} from '@/lib/branch/opsWriteBranch';
import { getCairoBusinessDate } from '@/lib/businessDate';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const sessionBranch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(sessionBranch)) return sessionBranch;

    const body = await req.json();
    const { empId, serviceIds, date, requestedFrom, source, branchId } = body;

    if (!empId || typeof empId !== 'number') {
      return NextResponse.json(
        { available: false, code: 'INVALID_EMP', message: 'empId مطلوب' },
        { status: 400 },
      );
    }

    if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
      return NextResponse.json(
        { available: false, code: 'NO_SERVICES', message: 'اختر خدمة واحدة على الأقل' },
        { status: 400 },
      );
    }

    const operationalDate =
      typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? date
        : getCairoBusinessDate();

    try {
      await resolveOpsWriteBranch({
        userId: sessionBranch.userId,
        sessionBranchId: sessionBranch.branchId,
        empId,
        workDate: operationalDate,
        requestedBranchId: branchId,
      });
    } catch (err) {
      const branchErr = opsWriteBranchErrorResponse(err);
      if (branchErr) {
        return NextResponse.json(
          {
            available: false,
            code: 'EMP_NOT_ASSIGNED',
            message:
              err instanceof Error
                ? err.message
                : 'الموظف غير متاح على فرع تملك صلاحية التشغيل عليه',
          },
          { status: 400 },
        );
      }
      throw err;
    }

    const result = await planQueueForBarber({
      empId,
      serviceIds,
      date,
      requestedFrom: requestedFrom ?? new Date().toISOString(),
      source: source ?? 'operations_barber_header',
    });

    if (!result.available) {
      return NextResponse.json(result, { status: 200 });
    }

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof QueuePlanForBarberError) {
      return NextResponse.json(
        { available: false, code: err.code, message: err.message },
        { status: err.status },
      );
    }

    console.error('[operations/queue/plan-for-barber] error:', err);
    return NextResponse.json(
      {
        available: false,
        code: 'PLAN_FAILED',
        message: err instanceof Error ? err.message : 'تعذر حساب الموعد',
      },
      { status: 500 },
    );
  }
}

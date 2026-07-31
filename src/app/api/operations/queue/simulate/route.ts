/**
 * POST /api/operations/queue/simulate
 *
 * Simulates creating a queue ticket without actually creating it.
 * Returns the suggested time, people before, and timeline analysis.
 */

import { NextRequest, NextResponse } from 'next/server';
import { simulateQueueInsertion } from '@/lib/operationsQueueTimeline';
import { requireBranchOperationAccess, isActiveBranchContext } from '@/lib/branch/context';
import { isEmployeeEligibleForBranchBookings } from '@/lib/branch/bookingQueueOwnership';
import { getCairoBusinessDate } from '@/lib/businessDate';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const body = await req.json();
    const { empId, serviceIds, requestedAt } = body;

    const serverNow = new Date();
    console.log('[simulate API] Request received:', {
      empId,
      serviceIds,
      requestedAtFromClient: requestedAt,
      serverNowUtc: serverNow.toISOString(),
      branchId: branch.branchId,
    });

    if (!empId || typeof empId !== 'number') {
      return NextResponse.json(
        { ok: false, error: 'empId مطلوب ويجب أن يكون رقماً' },
        { status: 400 },
      );
    }

    if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'serviceIds مطلوب ويجب أن يكون مصفوفة' },
        { status: 400 },
      );
    }

    const operationalDate = getCairoBusinessDate(requestedAt ? new Date(requestedAt) : serverNow);
    const eligible = await isEmployeeEligibleForBranchBookings({
      empId,
      branchId: branch.branchId,
      operationalDate,
      requireCanReceiveBookings: false,
      includeTemporaryTransfer: true,
    });
    if (!eligible) {
      return NextResponse.json(
        {
          ok: false,
          error: 'الموظف غير معيَّن على هذا الفرع — بدّل للفرع الصحيح من شريط الجلسة',
          reason: 'emp_not_assigned',
        },
        { status: 400 },
      );
    }

    const result = await simulateQueueInsertion({
      empId,
      serviceIds,
      requestedAt,
    });

    console.log('[simulate API] Response:', {
      empId: result.empId,
      decision: result.decision,
      suggestedStartTime: result.suggestedStartTime,
      suggestedEndTime: result.suggestedEndTime,
      peopleBefore: result.peopleBefore,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[operations/queue/simulate] error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'فشل في محاكاة إنشاء الدور',
      },
      { status: 500 },
    );
  }
}

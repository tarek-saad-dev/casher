/**
 * POST /api/operations/queue/simulate
 *
 * Simulates creating a queue ticket without actually creating it.
 * Optional body.branchId targets the barber's operational branch across sessions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { simulateQueueInsertion } from '@/lib/operationsQueueTimeline';
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
    const { empId, serviceIds, requestedAt, branchId } = body;

    const serverNow = new Date();
    console.log('[simulate API] Request received:', {
      empId,
      serviceIds,
      requestedAtFromClient: requestedAt,
      serverNowUtc: serverNow.toISOString(),
      sessionBranchId: sessionBranch.branchId,
      requestedBranchId: branchId,
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

    const operationalDate = getCairoBusinessDate(
      requestedAt ? new Date(requestedAt) : serverNow,
    );

    let targetBranchId = sessionBranch.branchId;
    try {
      const target = await resolveOpsWriteBranch({
        userId: sessionBranch.userId,
        sessionBranchId: sessionBranch.branchId,
        empId,
        workDate: operationalDate,
        requestedBranchId: branchId,
      });
      targetBranchId = target.branchId;
    } catch (err) {
      const branchErr = opsWriteBranchErrorResponse(err);
      if (branchErr) {
        return NextResponse.json(
          {
            ok: false,
            error:
              err instanceof Error
                ? err.message
                : 'الموظف غير متاح على فرع تملك صلاحية التشغيل عليه',
            reason: 'emp_not_assigned',
          },
          { status: 400 },
        );
      }
      throw err;
    }

    const result = await simulateQueueInsertion({
      empId,
      serviceIds,
      requestedAt,
      branchId: targetBranchId,
    });

    console.log('[simulate API] Response:', {
      empId: result.empId,
      decision: result.decision,
      suggestedStartTime: result.suggestedStartTime,
      suggestedEndTime: result.suggestedEndTime,
      peopleBefore: result.peopleBefore,
      branchId: targetBranchId,
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

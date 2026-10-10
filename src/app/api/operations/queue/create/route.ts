/**
 * POST /api/operations/queue/create
 *
 * Creates a queue ticket for walk-in customer.
 * Re-runs simulation before insert to ensure validity.
 * If time changed, returns 409 with new suggestion.
 * Accepts optional body.branchId to stamp the barber's operational branch
 * without requiring a session branch switch.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createOperationsQueueTicket,
  CreateOperationsQueueError,
  type CreateOperationsQueueInput,
} from '@/lib/operationsQueueCreateCore';
import { createQueueTicket } from '@/apps/queue/public';
import { isQueueSchedulingPortEnabled } from '@/apps/queue/internal/queuePortFlag';
import { buildQueuePortHooksForActor, buildStaffActorContext } from '@/lib/queueSchedulingComposition';
import type { CreateQueueRequest } from '@/lib/operationsQueueTypes';
import { requireBranchOperationAccess, isActiveBranchContext } from '@/lib/branch/context';
import {
  opsWriteBranchErrorResponse,
  resolveOpsWriteBranch,
} from '@/lib/branch/opsWriteBranch';
import { getCairoBusinessDate } from '@/lib/businessDate';

export type { CreateQueueRequest, CreateQueueResponse } from '@/lib/operationsQueueTypes';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const sessionBranch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(sessionBranch)) return sessionBranch;

    const body = (await req.json()) as CreateQueueRequest;

    const useClientPlannedTimes =
      body.source === 'operations_barber_header' || body.useClientPlannedTimes === true;

    const workDate = body.expectedStartTime
      ? getCairoBusinessDate(new Date(body.expectedStartTime))
      : getCairoBusinessDate();

    const target = await resolveOpsWriteBranch({
      tenantId: sessionBranch.tenantId,
      userId: sessionBranch.userId,
      sessionBranchId: sessionBranch.branchId,
      empId: body.empId,
      workDate,
      requestedBranchId: body.branchId,
    });

    const input: CreateOperationsQueueInput = {
      empId: body.empId,
      serviceIds: body.serviceIds,
      customer: body.customer,
      expectedStartTime: body.expectedStartTime,
      expectedEndTime: body.expectedEndTime,
      source: body.source,
      trustExpectedStart: useClientPlannedTimes,
      useClientPlannedTimes,
      branchId: target.branchId,
    };

    let response;
    if (isQueueSchedulingPortEnabled()) {
      const actor = await buildStaffActorContext(sessionBranch.userId, sessionBranch.tenantId);
      const queuePortHooks = await buildQueuePortHooksForActor(actor);
      response = await createQueueTicket({
        ...input,
        tenantId: actor.tenantId!,
        queuePortHooks,
      });
    } else {
      response = await createOperationsQueueTicket(input);
    }
    return NextResponse.json(response);
  } catch (err) {
    const branchErr = opsWriteBranchErrorResponse(err);
    if (branchErr) return branchErr;

    if (err instanceof CreateOperationsQueueError) {
      return NextResponse.json(
        { ok: false, error: err.message, ...err.payload },
        { status: err.status },
      );
    }

    console.error('[operations/queue/create] error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'فشل في إنشاء الدور',
      },
      { status: 500 },
    );
  }
}

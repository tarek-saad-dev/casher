/**
 * POST /api/operations/queue/create
 *
 * Creates a queue ticket for walk-in customer.
 * Re-runs simulation before insert to ensure validity.
 * If time changed, returns 409 with new suggestion.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createOperationsQueueTicket,
  CreateOperationsQueueError,
  type CreateOperationsQueueInput,
} from '@/lib/operationsQueueCreateCore';
import type { CreateQueueRequest } from '@/lib/operationsQueueTypes';
import { requireBranchOperationAccess, isActiveBranchContext } from '@/lib/branch/context';

export type { CreateQueueRequest, CreateQueueResponse } from '@/lib/operationsQueueTypes';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const body = (await req.json()) as CreateQueueRequest;

    const useClientPlannedTimes =
      body.source === 'operations_barber_header' || body.useClientPlannedTimes === true;

    const input: CreateOperationsQueueInput = {
      empId: body.empId,
      serviceIds: body.serviceIds,
      customer: body.customer,
      expectedStartTime: body.expectedStartTime,
      expectedEndTime: body.expectedEndTime,
      source: body.source,
      trustExpectedStart: useClientPlannedTimes,
      useClientPlannedTimes,
      branchId: branch.branchId,
    };

    const response = await createOperationsQueueTicket(input);
    return NextResponse.json(response);
  } catch (err) {
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

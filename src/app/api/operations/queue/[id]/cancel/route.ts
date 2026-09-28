/**
 * POST /api/operations/queue/[id]/cancel
 *
 * Cancels a queue ticket (soft cancel - updates status to 'cancelled')
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireBranchOperationAccess, isActiveBranchContext } from '@/lib/branch/context';
import { bookingQueueNotFoundResponse } from '@/lib/branch/bookingQueueOwnership';
import { userCanManageOpsBranchRecord } from '@/lib/branch/opsWriteBranch';
import { getPool, sql } from '@/lib/db';
import { cancelQueueTicket } from '@/apps/queue/public';
import { isQueueSchedulingPortEnabled } from '@/apps/queue/internal/queuePortFlag';
import {
  cancelQueueTicketCore,
  CancelQueueTicketError,
} from '@/lib/queueCancelCore';
import { buildQueuePortHooksForActor, buildStaffActorContext } from '@/lib/queueSchedulingComposition';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const { id } = await context.params;
    const ticketId = parseInt(id);

    if (isNaN(ticketId)) {
      return NextResponse.json({ error: 'معرف الدور غير صالح' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { reason, cancelBooking = false } = body;

    let userId = 0;
    try {
      const session = await getSession();
      userId = session?.UserID ?? 0;
    } catch {
      /* session optional */
    }

    const db = await getPool();
    const checkRes = await db
      .request()
      .input('ticketId', sql.Int, ticketId)
      .query(`SELECT BranchID FROM dbo.QueueTickets WHERE QueueTicketID = @ticketId`);

    if (checkRes.recordset.length === 0) {
      return NextResponse.json({ error: 'الدور غير موجود' }, { status: 404 });
    }

    if (
      !(await userCanManageOpsBranchRecord({
        userId: branch.userId,
        sessionBranchId: branch.branchId,
        recordBranchId: checkRes.recordset[0].BranchID,
      }))
    ) {
      return bookingQueueNotFoundResponse();
    }

    const cancelInput = {
      ticketId,
      reason,
      cancelBooking,
      userId,
      sessionBranchId: branch.branchId,
    };

    let result;
    if (isQueueSchedulingPortEnabled()) {
      const actor = await buildStaffActorContext(branch.userId);
      const queuePortHooks = await buildQueuePortHooksForActor(actor);
      result = await cancelQueueTicket({
        ...cancelInput,
        tenantId: actor.tenantId!,
        queuePortHooks,
      });
    } else {
      result = await cancelQueueTicketCore(cancelInput);
    }

    return NextResponse.json({
      ...result,
      message: result.message ?? 'تم إلغاء الدور بنجاح',
    });
  } catch (err) {
    if (err instanceof CancelQueueTicketError) {
      return NextResponse.json(
        { error: err.message, ...err.payload },
        { status: err.status },
      );
    }
    console.error('[queue/cancel] error:', err);
    return NextResponse.json({ error: 'فشل إلغاء الدور' }, { status: 500 });
  }
}

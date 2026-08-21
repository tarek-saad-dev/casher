/**
 * GET/PATCH /api/operations/affected-bookings
 * POST actions: alternatives | bulk-move | retry-whatsapp | cancel-booking
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  isActiveBranchContext,
  requireBranchOperationAccess,
} from '@/lib/branch/context';
import { getCairoBusinessDate } from '@/lib/businessDate';
import {
  listAffectedBookings,
  resolveAffectedBookingAction,
  updateBookingFollowUpStatus,
  ensureAffectedBookingTable,
} from '@/lib/booking/affectedBookings';
import { suggestAffectedBookingAlternatives } from '@/lib/booking/affectedBookingAlternatives';
import { rescheduleBookingMove } from '@/lib/bookingRescheduleCore';
import { loadBookingCustomerContact } from '@/lib/booking/bookingCustomerContact';
import {
  retryBookingEventWhatsApp,
  getLatestBookingNotifyStatus,
} from '@/lib/booking/bookingEventWhatsApp';

export const runtime = 'nodejs';

function canViewPhone(roles: string[] | undefined, isSuperAdmin?: boolean): boolean {
  if (isSuperAdmin) return true;
  const set = new Set((roles ?? []).map((r) => r.toLowerCase()));
  return (
    set.has('super_admin') ||
    set.has('admin') ||
    set.has('manager') ||
    set.has('receptionist') ||
    set.has('cashier')
  );
}

export async function GET(req: NextRequest) {
  const auth = await requirePageAccess('/operations');
  if (!isAuthResult(auth)) return auth;
  const branch = await requireBranchOperationAccess();
  if (!isActiveBranchContext(branch)) return branch;

  await ensureAffectedBookingTable();
  const sp = new URL(req.url).searchParams;
  const date = sp.get('date');
  const future = sp.get('future') === '1';
  const includePhone = canViewPhone(auth.roles, auth.isSuperAdmin);

  const rows = await listAffectedBookings({
    branchId: sp.get('branchId') === 'all' ? null : branch.branchId,
    businessDate: future ? null : date || getCairoBusinessDate(),
    dateFrom: future ? getCairoBusinessDate() : null,
    empId: sp.get('empId') ? Number(sp.get('empId')) : null,
    reasonCode: sp.get('reason') || null,
    unresolvedOnly: sp.get('unresolved') !== '0',
    whatsappFailed: sp.get('whatsappFailed') === '1',
    pendingCall: sp.get('pendingCall') === '1',
    includePhone,
  });

  return NextResponse.json({
    ok: true,
    date: date || getCairoBusinessDate(),
    includePhone,
    bookings: rows,
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await requirePageAccess('/operations');
  if (!isAuthResult(auth)) return auth;
  const branch = await requireBranchOperationAccess();
  if (!isActiveBranchContext(branch)) return branch;

  const body = (await req.json()) as Record<string, unknown>;
  const bookingId = Number(body.bookingId);
  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    return NextResponse.json({ ok: false, code: 'INVALID_BOOKING' }, { status: 400 });
  }

  if (typeof body.followUpStatus === 'string') {
    await updateBookingFollowUpStatus({
      bookingId,
      followUpStatus: body.followUpStatus as
        | 'not_required'
        | 'pending_call'
        | 'called'
        | 'no_answer'
        | 'resolved',
    });
    return NextResponse.json({ ok: true, followUpStatus: body.followUpStatus });
  }

  const status = String(body.status ?? 'resolved');
  await resolveAffectedBookingAction({
    bookingId,
    sourceEvent: typeof body.sourceEvent === 'string' ? body.sourceEvent : undefined,
    actorUserId: auth.userId,
    status: status as 'resolved' | 'cancelled' | 'left_pending' | 'unresolved' | 'pending',
  });
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const auth = await requirePageAccess('/operations');
  if (!isAuthResult(auth)) return auth;
  const branch = await requireBranchOperationAccess();
  if (!isActiveBranchContext(branch)) return branch;

  const body = (await req.json()) as Record<string, unknown>;
  const action = String(body.action ?? '');

  if (action === 'alternatives') {
    const bookingId = Number(body.bookingId);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return NextResponse.json({ ok: false, code: 'INVALID_BOOKING' }, { status: 400 });
    }
    const alternatives = await suggestAffectedBookingAlternatives({
      bookingId,
      allowOtherBranch: body.allowOtherBranch === true,
    });
    return NextResponse.json({ ok: true, alternatives });
  }

  if (action === 'move') {
    const bookingId = Number(body.bookingId);
    const newStartAt = String(body.newStartAt ?? '');
    const operationalDate = String(body.operationalDate ?? getCairoBusinessDate());
    const targetEmpId = body.targetEmpId != null ? Number(body.targetEmpId) : undefined;
    if (!Number.isInteger(bookingId) || !newStartAt) {
      return NextResponse.json({ ok: false, code: 'INVALID_INPUT' }, { status: 400 });
    }
    try {
      const moved = await rescheduleBookingMove({
        bookingId,
        newStartAt,
        operationalDate,
        source: 'operations_affected',
        userId: auth.userId,
        targetEmpId,
      });
      await resolveAffectedBookingAction({
        bookingId,
        actorUserId: auth.userId,
        status: 'moved',
      });
      return NextResponse.json({ ok: true, moved });
    } catch (err) {
      return NextResponse.json(
        {
          ok: false,
          code: (err as { code?: string })?.code ?? 'MOVE_FAILED',
          error: err instanceof Error ? err.message : 'فشل النقل',
        },
        { status: 409 },
      );
    }
  }

  if (action === 'bulk-move') {
    const items = Array.isArray(body.items) ? body.items : [];
    const results: Array<{
      bookingId: number;
      ok: boolean;
      code?: string;
      error?: string;
      newStartAt?: string;
    }> = [];
    for (const raw of items) {
      const item = raw as Record<string, unknown>;
      const bookingId = Number(item.bookingId);
      const newStartAt = String(item.newStartAt ?? '');
      const operationalDate = String(item.operationalDate ?? getCairoBusinessDate());
      const targetEmpId = item.targetEmpId != null ? Number(item.targetEmpId) : undefined;
      if (!Number.isInteger(bookingId) || !newStartAt) {
        results.push({ bookingId, ok: false, code: 'INVALID_INPUT', error: 'مدخلات غير صالحة' });
        continue;
      }
      try {
        const moved = await rescheduleBookingMove({
          bookingId,
          newStartAt,
          operationalDate,
          source: 'operations_affected_bulk',
          userId: auth.userId,
          targetEmpId,
        });
        await resolveAffectedBookingAction({
          bookingId,
          actorUserId: auth.userId,
          status: 'moved',
        });
        results.push({ bookingId, ok: true, newStartAt: moved.newStartAt });
      } catch (err) {
        results.push({
          bookingId,
          ok: false,
          code: (err as { code?: string })?.code ?? 'MOVE_FAILED',
          error: err instanceof Error ? err.message : 'فشل النقل',
        });
      }
    }
    return NextResponse.json({
      ok: true,
      results,
      successCount: results.filter((r) => r.ok).length,
      failCount: results.filter((r) => !r.ok).length,
    });
  }

  if (action === 'retry-whatsapp') {
    const bookingId = Number(body.bookingId);
    const eventType = String(body.eventType ?? 'move') as 'move' | 'cancel';
    if (!Number.isInteger(bookingId)) {
      return NextResponse.json({ ok: false, code: 'INVALID_BOOKING' }, { status: 400 });
    }
    const result = await retryBookingEventWhatsApp({ bookingId, eventType });
    return NextResponse.json(result);
  }

  if (action === 'whatsapp-status') {
    const bookingId = Number(body.bookingId);
    const status = await getLatestBookingNotifyStatus(bookingId);
    return NextResponse.json({ ok: true, status });
  }

  if (action === 'cancel-booking') {
    const bookingId = Number(body.bookingId);
    const contact = await loadBookingCustomerContact(bookingId);
    if (!contact) {
      return NextResponse.json({ ok: false, code: 'BOOKING_NOT_FOUND' }, { status: 404 });
    }
    try {
      const { getPool, sql } = await import('@/lib/db');
      const db = await getPool();
      const upd = await db
        .request()
        .input('id', sql.Int, bookingId)
        .input('reason', sql.NVarChar(200), 'إلغاء صريح — حجوزات متأثرة')
        .query(`
          UPDATE dbo.Bookings
          SET Status='cancelled', CancelReason=@reason, CancelledAt=GETDATE(), UpdatedAt=GETDATE()
          WHERE BookingID=@id
            AND Status NOT IN (N'cancelled', N'completed', N'converted')
          SELECT @@ROWCOUNT AS Affected;
        `);
      if (Number(upd.recordset[0]?.Affected ?? 0) < 1) {
        return NextResponse.json(
          { ok: false, code: 'NOT_CANCELLABLE', error: 'الحجز غير قابل للإلغاء' },
          { status: 409 },
        );
      }

      if (contact.empId && contact.bookingDate) {
        try {
          const { AvailabilityMutationNotifier } = await import(
            '@/lib/booking/AvailabilityMutationNotifier'
          );
          await AvailabilityMutationNotifier.bookingOccupancyChanged({
            employeeId: contact.empId,
            businessDate: contact.bookingDate,
            branchId: contact.branchId,
            reason: 'affected_bookings_cancel',
          });
        } catch {
          /* best-effort */
        }
      }

      const { scheduleCancelWhatsAppAfterCommit } = await import(
        '@/lib/booking/bookingEventWhatsApp'
      );
      await scheduleCancelWhatsAppAfterCommit(bookingId);
      await resolveAffectedBookingAction({
        bookingId,
        actorUserId: auth.userId,
        status: 'cancelled',
      });
      return NextResponse.json({ ok: true, cancelled: true });
    } catch (err) {
      return NextResponse.json(
        {
          ok: false,
          code: (err as { code?: string })?.code ?? 'CANCEL_FAILED',
          error: err instanceof Error ? err.message : 'فشل الإلغاء',
        },
        { status: 409 },
      );
    }
  }

  return NextResponse.json({ ok: false, code: 'UNKNOWN_ACTION' }, { status: 400 });
}

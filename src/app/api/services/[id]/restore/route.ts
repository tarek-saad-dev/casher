import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  executeAuditedAction,
  isAuditedActionError,
  writeSensitiveAuditEvent,
} from '@/lib/sensitiveActionAudit';
import type { SessionUser } from '@/lib/session-types';
import { invalidatePublicBookingServicesCache } from '@/lib/booking/publicBookingServices';
import { evaluateServiceEligibility } from '@/lib/booking/publicBookingServicePolicy';

function toSessionUser(auth: {
  userId: number;
  userName: string;
  userLevel: string;
  activeBranchId: number;
  activeBranchCode: string;
}): SessionUser {
  return {
    UserID: auth.userId,
    UserName: auth.userName,
    UserLevel: auth.userLevel === 'admin' ? 'admin' : 'user',
    ActiveBranchID: auth.activeBranchId,
    ActiveBranchCode: auth.activeBranchCode,
    BranchSessionVersion: 1,
  };
}

async function loadServiceRow(proId: number, connection?: sql.Transaction) {
  const pool = await getPool();
  const req = connection ? new sql.Request(connection) : pool.request();

  const result = await req.input('ProID', sql.Int, proId).query(`
    SELECT
      p.ProID, p.ProName, p.ProNameAr, p.SPrice1, p.Bonus,
      p.CatID, c.CatName, c.CatType,
      ISNULL(p.ProType, '') AS ProType,
      p.isDeleted, p.DurationMinutes
    FROM dbo.TblPro p
    LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
    WHERE p.ProID = @ProID
  `);
  return (result.recordset[0] as Record<string, unknown> | undefined) ?? null;
}

/**
 * PATCH /api/services/[id]/restore
 * Soft-restore: SET isDeleted = 0 on the existing TblPro row (no insert).
 * Idempotent if already active.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePageAccess('/admin/services');
  if (!isAuthResult(auth)) return auth;

  try {
    const { id } = await params;
    const serviceId = parseInt(id, 10);
    if (!Number.isFinite(serviceId) || serviceId <= 0) {
      return NextResponse.json({ error: 'معرف الخدمة غير صالح' }, { status: 400 });
    }

    const existing = await loadServiceRow(serviceId);
    if (!existing) {
      return NextResponse.json({ error: 'الخدمة غير موجودة' }, { status: 404 });
    }

    const user = toSessionUser(auth);

    // Already active — safe no-op (idempotent)
    if (Number(existing.isDeleted) !== 1) {
      try {
        await writeSensitiveAuditEvent({
          actionType: 'restore_service',
          user,
          request: req,
          actionMethod: 'PATCH',
          endpointPath: `/api/services/${serviceId}/restore`,
          entityId: serviceId,
          executionStatus: 'success',
          reason: 'already_active',
          oldData: { ProID: existing.ProID, isDeleted: existing.isDeleted },
          newData: { ProID: existing.ProID, isDeleted: existing.isDeleted },
          changedFields: [],
        });
      } catch (auditErr) {
        console.warn('[api/services/restore] audit skip (already active):', auditErr);
      }

      return NextResponse.json({
        ok: true,
        alreadyActive: true,
        message: 'الخدمة نشطة بالفعل',
        service: existing,
      });
    }

    const auditResult = await executeAuditedAction({
      actionType: 'restore_service',
      user,
      entityId: serviceId,
      request: req,
      actionMethod: 'PATCH',
      endpointPath: `/api/services/${serviceId}/restore`,
      loadOldData: async (tx) => loadServiceRow(serviceId, tx),
      execute: async (tx) => {
        const update = await new sql.Request(tx)
          .input('ProID', sql.Int, serviceId)
          .query(`
            UPDATE dbo.TblPro
            SET isDeleted = 0
            WHERE ProID = @ProID AND isDeleted = 1;

            SELECT @@ROWCOUNT AS Affected;
          `);
        const affected = Number(update.recordset?.[0]?.Affected ?? 0);
        return { affected };
      },
      loadNewData: async (tx) => loadServiceRow(serviceId, tx),
    });

    const restored = await loadServiceRow(serviceId);
    invalidatePublicBookingServicesCache();

    const eligibility = restored
      ? evaluateServiceEligibility({
          ProID: Number(restored.ProID),
          ProName: String(restored.ProName ?? ''),
          ProNameAr: (restored.ProNameAr as string | null) ?? null,
          SPrice1: restored.SPrice1 as number | null,
          DurationMinutes: restored.DurationMinutes as number | null,
          isDeleted: restored.isDeleted as number | boolean | null,
          ProType: (restored.ProType as string | null) ?? null,
          CatID: restored.CatID as number | null,
          CatName: (restored.CatName as string | null) ?? null,
          CatType: (restored.CatType as string | null) ?? null,
        })
      : null;

    return NextResponse.json({
      ok: true,
      alreadyActive: false,
      message: 'تم استعادة الخدمة بنجاح',
      auditId: auditResult.auditId,
      service: restored,
      publicBookable: eligibility?.eligible === true,
      publicBookableReason: eligibility?.reason ?? null,
      note:
        eligibility?.eligible === true
          ? 'الخدمة مؤهلة للظهور في الحجز العام بعد الاستعادة'
          : 'الاستعادة لا تتجاوز قواعد الحجز العام — الخدمة لن تظهر للعامة حتى تكتمل المدة/السعر/التصنيف',
    });
  } catch (err: unknown) {
    if (isAuditedActionError(err)) {
      return NextResponse.json(
        { error: err.message, auditId: err.failedAuditId },
        { status: 500 },
      );
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/services/[id]/restore] PATCH error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

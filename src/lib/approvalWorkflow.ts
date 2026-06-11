// ── Approval Workflow ─────────────────────────────────────────────────────────
// Central engine for the approval system.
// Rules:
//   - super_admin → execute immediately + audit log
//   - everyone else → create pending ApprovalRequest, do NOT execute
//   - approve/reject → super_admin only, requester cannot approve own request
//   - idempotent: already-executed / rejected requests cannot be re-executed

import { getPool } from '@/lib/db';
import sql from 'mssql';
import { getUserAccess } from '@/lib/permissions-server';
import { APPROVAL_ACTIONS } from '@/lib/approvalActionsRegistry';
import type { RiskLevel } from '@/lib/approvalActionsRegistry';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ApprovalStatus =
  | 'pending' | 'approved' | 'rejected' | 'executed' | 'failed' | 'cancelled';

export interface CreateApprovalParams {
  requestType: string;
  entityType: string;
  entityId?: string | null;
  actionMethod: string;
  endpointPath?: string | null;
  requestedByUserId: number;
  oldData?: Record<string, unknown> | null;
  newData?: Record<string, unknown> | null;
  reason?: string | null;
  riskLevel?: RiskLevel;
}

export interface WorkflowResult {
  executed: boolean;       // true = ran immediately (super_admin)
  pendingApproval: boolean;// true = queued for approval
  approvalId?: number;
  message: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function isSuperAdminUser(userId: number, userName: string): Promise<boolean> {
  const access = await getUserAccess(userId, userName, 'admin');
  return access.isSuperAdmin;
}

async function auditLog(
  db: sql.ConnectionPool,
  actorId: number,
  action: string,
  targetType: string,
  targetId: string | null,
  details: Record<string, unknown>
) {
  try {
    await db.request()
      .input('actor',  sql.Int,      actorId)
      .input('action', sql.NVarChar, action)
      .input('ttype',  sql.NVarChar, targetType)
      .input('tid',    sql.NVarChar, targetId ?? '')
      .input('det',    sql.NVarChar, JSON.stringify(details))
      .query(`
        INSERT INTO dbo.TblPermissionAuditLog (UserID, Action, TargetType, TargetID, Details)
        VALUES (@actor, @action, @ttype, @tid, @det)
      `);
  } catch {
    // audit failure must not block the main operation
  }
}

// ── Core: createApprovalRequest ───────────────────────────────────────────────

export async function createApprovalRequest(
  params: CreateApprovalParams
): Promise<number> {
  const db = await getPool();
  const result = await db.request()
    .input('rt',   sql.NVarChar, params.requestType)
    .input('et',   sql.NVarChar, params.entityType)
    .input('eid',  sql.NVarChar, params.entityId ?? null)
    .input('am',   sql.NVarChar, params.actionMethod)
    .input('ep',   sql.NVarChar, params.endpointPath ?? null)
    .input('uid',  sql.Int,      params.requestedByUserId)
    .input('old',  sql.NVarChar, params.oldData ? JSON.stringify(params.oldData) : null)
    .input('new',  sql.NVarChar, params.newData ? JSON.stringify(params.newData) : null)
    .input('rsn',  sql.NVarChar, params.reason ?? null)
    .input('risk', sql.NVarChar, params.riskLevel ?? 'medium')
    .query(`
      INSERT INTO dbo.TblApprovalRequests
        (RequestType, EntityType, EntityID, ActionMethod, EndpointPath,
         RequestedByUserID, OldData, NewData, Reason, RiskLevel)
      OUTPUT INSERTED.ApprovalID
      VALUES (@rt, @et, @eid, @am, @ep, @uid, @old, @new, @rsn, @risk)
    `);
  return result.recordset[0].ApprovalID as number;
}

// ── Core: requireApprovalOrExecute ────────────────────────────────────────────

export async function requireApprovalOrExecute(params: {
  userId: number;
  userName: string;
  requestType: string;
  entityId?: string | null;
  actionMethod: string;
  endpointPath?: string;
  oldDataLoader?: () => Promise<Record<string, unknown> | null>;
  newData?: Record<string, unknown> | null;
  reason?: string | null;
  riskLevel?: RiskLevel;
}): Promise<WorkflowResult> {
  const actionDef = APPROVAL_ACTIONS[params.requestType];
  if (!actionDef) {
    throw new Error(`Unknown requestType: ${params.requestType}`);
  }

  const superAdmin = await isSuperAdminUser(params.userId, params.userName);

  if (superAdmin) {
    // Execute immediately
    const oldData = params.oldDataLoader ? await params.oldDataLoader() : null;
    await actionDef.execute({
      entityId: params.entityId ?? null,
      oldData,
      newData: params.newData ?? null,
    });
    const db = await getPool();
    await auditLog(db, params.userId, `direct_execute:${params.requestType}`, actionDef.entityType, params.entityId ?? null, {
      newData: params.newData,
      reason: params.reason,
    });
    return { executed: true, pendingApproval: false, message: 'تم تنفيذ العملية مباشرة' };
  }

  // Non super_admin → create pending request
  const oldData = params.oldDataLoader ? await params.oldDataLoader() : null;
  const approvalId = await createApprovalRequest({
    requestType:       params.requestType,
    entityType:        actionDef.entityType,
    entityId:          params.entityId,
    actionMethod:      params.actionMethod,
    endpointPath:      params.endpointPath,
    requestedByUserId: params.userId,
    oldData,
    newData:           params.newData,
    reason:            params.reason,
    riskLevel:         params.riskLevel ?? actionDef.riskLevel,
  });

  return {
    executed: false,
    pendingApproval: true,
    approvalId,
    message: `تم إرسال الطلب رقم #${approvalId} للموافقة من السوبر أدمن`,
  };
}

// ── Core: approveRequest ──────────────────────────────────────────────────────

export async function approveRequest(
  approvalId: number,
  reviewedByUserId: number,
  reviewedByUserName: string,
  note?: string
): Promise<{ ok: boolean; message: string }> {
  const superAdmin = await isSuperAdminUser(reviewedByUserId, reviewedByUserName);
  if (!superAdmin) return { ok: false, message: 'غير مصرح — الموافقة تتطلب super_admin' };

  const db = await getPool();
  const row = await db.request()
    .input('id', sql.Int, approvalId)
    .query(`SELECT * FROM dbo.TblApprovalRequests WHERE ApprovalID = @id`);

  if (!row.recordset.length) return { ok: false, message: 'الطلب غير موجود' };
  const req = row.recordset[0];

  if (req.Status !== 'pending') {
    return { ok: false, message: `الطلب في حالة "${req.Status}" ولا يمكن الموافقة عليه` };
  }
  if (req.RequestedByUserID === reviewedByUserId) {
    return { ok: false, message: 'لا يمكن الموافقة على طلبك الخاص' };
  }

  const actionDef = APPROVAL_ACTIONS[req.RequestType];
  if (!actionDef) {
    await db.request()
      .input('id',  sql.Int,      approvalId)
      .input('err', sql.NVarChar, `Unknown requestType: ${req.RequestType}`)
      .query(`UPDATE dbo.TblApprovalRequests SET Status='failed', ErrorMessage=@err WHERE ApprovalID=@id`);
    return { ok: false, message: `نوع العملية "${req.RequestType}" غير معرّف في الـ registry` };
  }

  // Mark approved
  await db.request()
    .input('id',   sql.Int,      approvalId)
    .input('uid',  sql.Int,      reviewedByUserId)
    .input('note', sql.NVarChar, note ?? null)
    .query(`
      UPDATE dbo.TblApprovalRequests
      SET Status='approved', ReviewedByUserID=@uid, ReviewedAt=GETDATE(), ReviewNote=@note
      WHERE ApprovalID=@id
    `);

  // Execute
  try {
    await actionDef.execute({
      entityId: req.EntityID ?? null,
      oldData:  req.OldData ? JSON.parse(req.OldData) : null,
      newData:  req.NewData ? JSON.parse(req.NewData) : null,
    });

    await db.request()
      .input('id', sql.Int, approvalId)
      .query(`UPDATE dbo.TblApprovalRequests SET Status='executed', ExecutedAt=GETDATE() WHERE ApprovalID=@id`);

    await auditLog(db, reviewedByUserId, `approved_execute:${req.RequestType}`, actionDef.entityType, req.EntityID, {
      approvalId,
      requestedBy: req.RequestedByUserID,
      note,
    });

    return { ok: true, message: 'تمت الموافقة وتنفيذ العملية بنجاح' };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.request()
      .input('id',  sql.Int,      approvalId)
      .input('err', sql.NVarChar, msg)
      .query(`UPDATE dbo.TblApprovalRequests SET Status='failed', ErrorMessage=@err WHERE ApprovalID=@id`);
    return { ok: false, message: `فشل تنفيذ العملية: ${msg}` };
  }
}

// ── Core: rejectRequest ───────────────────────────────────────────────────────

export async function rejectRequest(
  approvalId: number,
  reviewedByUserId: number,
  reviewedByUserName: string,
  note?: string
): Promise<{ ok: boolean; message: string }> {
  const superAdmin = await isSuperAdminUser(reviewedByUserId, reviewedByUserName);
  if (!superAdmin) return { ok: false, message: 'غير مصرح — الرفض يتطلب super_admin' };

  const db = await getPool();
  const row = await db.request()
    .input('id', sql.Int, approvalId)
    .query(`SELECT Status, RequestedByUserID FROM dbo.TblApprovalRequests WHERE ApprovalID=@id`);

  if (!row.recordset.length) return { ok: false, message: 'الطلب غير موجود' };
  const req = row.recordset[0];
  if (req.Status !== 'pending') {
    return { ok: false, message: `الطلب في حالة "${req.Status}" ولا يمكن رفضه` };
  }

  await db.request()
    .input('id',   sql.Int,      approvalId)
    .input('uid',  sql.Int,      reviewedByUserId)
    .input('note', sql.NVarChar, note ?? null)
    .query(`
      UPDATE dbo.TblApprovalRequests
      SET Status='rejected', ReviewedByUserID=@uid, ReviewedAt=GETDATE(), ReviewNote=@note
      WHERE ApprovalID=@id
    `);

  await auditLog(db, reviewedByUserId, `rejected:${approvalId}`, 'TblApprovalRequests', String(approvalId), { note });

  return { ok: true, message: 'تم رفض الطلب' };
}

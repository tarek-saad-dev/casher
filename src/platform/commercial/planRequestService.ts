import 'server-only';
import { randomUUID } from 'node:crypto';
import { getPool, sql } from '@/lib/db';
import { publishPlatformOutboxEvent } from '@/platform/outbox/publisher';
import { assertNotBootstrapTenant } from '@/platform/commercial/bootstrapGuard';
import { getPlan, getTenantSubscription, type SqlExecutor } from '@/platform/commercial/planRepository';
import { acquireTenantApplock, TENANT_COMMERCIAL_LOCK_PARTS } from '@/platform/tenant/tenantApplock';
import { quoteTenantPlan, PlanRequestError, type BillingCycle, type PlanRequestStatus } from './planRequestPolicy';

export type PlanRequestRow = {
  requestId: string;
  tenantId: string;
  fromPlanCode: string;
  requestedPlanCode: string;
  billingCycle: BillingCycle;
  quotedAmountEgp: number;
  status: PlanRequestStatus;
  subscriptionRevision: number;
  requestedByUserId: number;
  createdAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
};

function rowToRequest(r: Record<string, unknown>): PlanRequestRow {
  return {
    requestId: String(r.RequestId),
    tenantId: String(r.TenantId),
    fromPlanCode: String(r.FromPlanCode),
    requestedPlanCode: String(r.RequestedPlanCode),
    billingCycle: String(r.BillingCycle) as BillingCycle,
    quotedAmountEgp: Number(r.QuotedAmountEgp),
    status: String(r.Status) as PlanRequestStatus,
    subscriptionRevision: Number(r.SubscriptionRevision),
    requestedByUserId: Number(r.RequestedByUserId),
    createdAt: new Date(String(r.CreatedAt)).toISOString(),
    reviewedAt: r.ReviewedAt ? new Date(String(r.ReviewedAt)).toISOString() : null,
    reviewNote: r.ReviewNote == null ? null : String(r.ReviewNote),
  };
}

const REQUEST_COLUMNS = `RequestId,TenantId,FromPlanCode,RequestedPlanCode,BillingCycle,QuotedAmountEgp,
  Status,SubscriptionRevision,RequestedByUserId,CreatedAt,ReviewedAt,ReviewNote`;

export async function getTenantPlanRequests(ex: SqlExecutor, tenantId: string): Promise<PlanRequestRow[]> {
  const r = await ex.request().input('tenantId', sql.UniqueIdentifier, tenantId).query(`
    SELECT TOP 10 ${REQUEST_COLUMNS}
    FROM dbo.TenantPlanChangeRequest
    WHERE TenantId = @tenantId
    ORDER BY CreatedAt DESC, RequestId DESC;`);
  return (r.recordset as Record<string, unknown>[]).map(rowToRequest);
}

export async function submitTenantPlanRequest(args: {
  tenantId: string;
  actorUserId: number;
  planCode: string;
  billingCycle: BillingCycle;
  expectedRevision: number;
}): Promise<PlanRequestRow> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await assertNotBootstrapTenant(tx, args.tenantId, 'submitTenantPlanRequest');
    await acquireTenantApplock(tx, args.tenantId, TENANT_COMMERCIAL_LOCK_PARTS);
    const sub = await getTenantSubscription(tx, args.tenantId, { forUpdate: true });
    if (!sub) throw new PlanRequestError('SUBSCRIPTION_NOT_FOUND', 'مفيش اشتراك مسجل للمنشأة', 404);
    if (sub.revision !== args.expectedRevision) {
      throw new PlanRequestError('REVISION_CONFLICT', 'اشتراكك اتغير، حدّث الصفحة قبل إرسال طلب جديد', 409);
    }
    const dbPlan = await getPlan(tx, args.planCode);
    const quote = quoteTenantPlan(args.planCode, args.billingCycle, sub, dbPlan);
    const existing = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, args.tenantId)
      .query(`
        SELECT TOP 1 ${REQUEST_COLUMNS}
        FROM dbo.TenantPlanChangeRequest WITH (UPDLOCK, HOLDLOCK)
        WHERE TenantId = @tenantId AND Status = N'pending';`);
    if (existing.recordset.length) {
      const prior = rowToRequest(existing.recordset[0] as Record<string, unknown>);
      if (prior.requestedPlanCode !== quote.planCode || prior.billingCycle !== quote.billingCycle ||
          prior.quotedAmountEgp !== quote.amountEgp ||
          prior.subscriptionRevision !== quote.subscriptionRevision) {
        throw new PlanRequestError('REQUEST_ALREADY_PENDING', 'عندك طلب اشتراك منتظر المراجعة بالفعل', 409);
      }
      await tx.commit();
      return prior; // idempotent retry, no second outbox event
    }
    const requestId = randomUUID();
    const created = await new sql.Request(tx)
      .input('requestId', sql.UniqueIdentifier, requestId)
      .input('tenantId', sql.UniqueIdentifier, args.tenantId)
      .input('fromPlan', sql.NVarChar(32), quote.fromPlanCode)
      .input('planCode', sql.NVarChar(32), quote.planCode)
      .input('cycle', sql.NVarChar(10), quote.billingCycle)
      .input('amount', sql.Decimal(12, 2), quote.amountEgp)
      .input('revision', sql.Int, quote.subscriptionRevision)
      .input('actor', sql.Int, args.actorUserId)
      .query(`
        INSERT INTO dbo.TenantPlanChangeRequest
          (RequestId,TenantId,FromPlanCode,RequestedPlanCode,BillingCycle,QuotedAmountEgp,SubscriptionRevision,RequestedByUserId)
        VALUES (@requestId,@tenantId,@fromPlan,@planCode,@cycle,@amount,@revision,@actor);
        SELECT ${REQUEST_COLUMNS} FROM dbo.TenantPlanChangeRequest
        WHERE RequestId = @requestId AND TenantId = @tenantId;`);
    const result = rowToRequest(created.recordset[0] as Record<string, unknown>);
    await publishPlatformOutboxEvent(tx, {
      tenantId: args.tenantId,
      aggregateType: 'tenant_plan_request',
      aggregateId: requestId,
      eventType: 'tenant.plan.requested',
      payload: JSON.stringify({ requestId, planCode: quote.planCode, billingCycle: quote.billingCycle,
        quotedAmountEgp: quote.amountEgp, currency: quote.currency, paid: false,
        subscriptionChanged: false, actorUserId: args.actorUserId }),
      idempotencyKey: 'tenant-plan-request:' + requestId,
      correlationId: 'tenant-subscription:' + args.tenantId,
      occurredAt: new Date(),
    });
    await tx.commit();
    return result;
  } catch (err) {
    try { await tx.rollback(); } catch { /* ignore rollback failures */ }
    throw err;
  }
}

/** Operator queue: requests have no implicit effect on subscription or balance. */
export async function getPendingPlanRequests(): Promise<PlanRequestRow[]> {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT TOP 100 ${REQUEST_COLUMNS} FROM dbo.TenantPlanChangeRequest
    WHERE Status = N'pending' ORDER BY CreatedAt ASC, RequestId ASC;`);
  return (r.recordset as Record<string, unknown>[]).map(rowToRequest);
}

/**
 * Review-only state. 'contacted' means contacted, NEVER paid/approved.
 * Activations remain in the existing platform-operator subscription API after external verification.
 */
export async function reviewTenantPlanRequest(args: {
  requestId: string;
  action: 'contacted' | 'rejected';
  note: string;
  actorUserId: number;
}): Promise<void> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const found = await new sql.Request(tx).input('requestId', sql.UniqueIdentifier, args.requestId)
      .query(`SELECT TenantId FROM dbo.TenantPlanChangeRequest WHERE RequestId=@requestId;`);
    const tenantId = String(found.recordset[0]?.TenantId ?? '');
    if (!tenantId) throw new PlanRequestError('REQUEST_NOT_FOUND', 'الطلب مش موجود', 404);
    await assertNotBootstrapTenant(tx, tenantId, 'reviewTenantPlanRequest');
    await acquireTenantApplock(tx, tenantId, TENANT_COMMERCIAL_LOCK_PARTS);
    const r = await new sql.Request(tx)
      .input('requestId', sql.UniqueIdentifier, args.requestId)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('status', sql.NVarChar(16), args.action)
      .input('note', sql.NVarChar(500), args.note)
      .input('actor', sql.Int, args.actorUserId)
      .query(`
        UPDATE dbo.TenantPlanChangeRequest
        SET Status=@status, ReviewNote=@note, ReviewedByUserId=@actor,
            ReviewedAt=SYSUTCDATETIME(),UpdatedAt=SYSUTCDATETIME()
        WHERE RequestId=@requestId AND TenantId=@tenantId AND Status=N'pending';
        SELECT @@ROWCOUNT AS changed;`);
    if (Number(r.recordset[0]?.changed) !== 1) {
      throw new PlanRequestError('REQUEST_ALREADY_REVIEWED', 'الطلب مش في حالة انتظار', 409);
    }
    await publishPlatformOutboxEvent(tx, {
      tenantId, aggregateType: 'tenant_plan_request', aggregateId: args.requestId,
      eventType: 'tenant.plan.request_reviewed',
      payload: JSON.stringify({ requestId: args.requestId, action: args.action, paid: false,
        subscriptionChanged: false, actorUserId: args.actorUserId }),
      idempotencyKey: 'tenant-plan-review:' + args.requestId + ':' + args.action,
      correlationId: 'tenant-subscription:' + tenantId, occurredAt: new Date(),
    });
    await tx.commit();
  } catch (err) {
    try { await tx.rollback(); } catch { /* ignore */ }
    throw err;
  }
}

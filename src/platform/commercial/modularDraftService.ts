import 'server-only';
import { randomUUID } from 'node:crypto';
import { getPool, sql } from '@/lib/db';
import { findIndustryPack } from '@/packs';
import { getTenantPackState } from '@/platform/apps/tenantApps';
import { assertNotBootstrapTenant } from './bootstrapGuard';
import type { SqlExecutor } from './planRepository';
import { publishPlatformOutboxEvent } from '@/platform/outbox/publisher';
import { acquireTenantApplock, TENANT_COMMERCIAL_LOCK_PARTS } from '@/platform/tenant/tenantApplock';
import {
  catalogCodeForPack, ModularDraftError, selectableDraftApps,
  validateModularDraftSelection, type DraftCycle,
} from './modularDraftPolicy';

export type TenantDraftState = {
  mode: 'draft_only';
  canCharge: false;
  canActivate: false;
  changesInstalledApps: false;
  changesSubscription: false;
  catalog: { code: string; status: 'draft'; version: 1 };
  industry: string;
  options: ReturnType<typeof selectableDraftApps>;
  draft: null | {
    draftId: string; apps: string[]; branches: number; billingCycle: DraftCycle;
    revision: number; updatedAt: string;
  };
};

type DraftRow = { DraftId: string; BillingCycle: DraftCycle; BranchCount: number; Revision: number; UpdatedAt: Date | string };

async function loadDraftApps(ex: SqlExecutor, tenantId: string, draftId: string): Promise<string[]> {
  const data = await ex.request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('draftId', sql.UniqueIdentifier, draftId)
    .query(`
      SELECT a.AppCode FROM dbo.TenantModularDraftApp a
      INNER JOIN dbo.TenantModularDraft d ON d.DraftId=a.DraftId
      WHERE d.TenantId=@tenantId AND d.DraftId=@draftId AND d.Status=N'draft'
      ORDER BY a.AppCode;`);
  return (data.recordset as Array<{AppCode:string}>).map(x=>String(x.AppCode));
}

async function findDraftCatalog(ex: SqlExecutor, catalogCode: string): Promise<string> {
  const r = await ex.request().input('catalogCode',sql.NVarChar(64), catalogCode).query(`
    SELECT TOP 1 CatalogId FROM dbo.ModularPriceCatalog
    WHERE CatalogCode=@catalogCode AND Version=1 AND CurrencyCode='EGP' AND Status=N'draft';`);
  if (!r.recordset[0]?.CatalogId) {
    throw new ModularDraftError('DRAFT_CATALOG_NOT_READY',
      'تجهيز المسودات مش متاح حاليًا. يلزم تفعيل تحديث قاعدة البيانات.', 503);
  }
  return String(r.recordset[0].CatalogId);
}

export async function getTenantModularDraft(tenantId: string): Promise<TenantDraftState> {
  const pool = await getPool();
  const packState = await getTenantPackState(pool, tenantId);
  const pack = packState ? findIndustryPack(packState.packCode) : null;
  if (!pack) throw new ModularDraftError('PACK_NOT_FOUND', 'مفيش نشاط مجهز لهذه المنشأة', 409);
  const catalogCode = catalogCodeForPack(pack);
  const catalogId = await findDraftCatalog(pool, catalogCode);
  const rows = await pool.request().input('tenantId',sql.UniqueIdentifier,tenantId)
    .input('catalogId',sql.UniqueIdentifier,catalogId).query(`
      SELECT DraftId, BillingCycle, BranchCount, Revision, UpdatedAt
      FROM dbo.TenantModularDraft
      WHERE TenantId=@tenantId AND CatalogId=@catalogId AND Status=N'draft';`);
  const row = rows.recordset[0] as DraftRow | undefined;
  return {
    mode:'draft_only',canCharge:false,canActivate:false,changesInstalledApps:false,changesSubscription:false,
    industry:pack.packCode,
    catalog:{code:catalogCode,status:'draft',version:1},
    options:selectableDraftApps(pack),
    draft: row ? {
      draftId:String(row.DraftId),
      apps:await loadDraftApps(pool, tenantId, String(row.DraftId)),
      branches:Number(row.BranchCount),
      billingCycle:String(row.BillingCycle) as DraftCycle,
      revision:Number(row.Revision),
      updatedAt:new Date(row.UpdatedAt).toISOString(),
    } : null,
  };
}

export async function saveTenantModularDraft(args: {
  tenantId: string; actorUserId: number;
  apps: string[]; branches: number; billingCycle: DraftCycle;
  expectedRevision: number | null;
}): Promise<TenantDraftState> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    // Transactional protection even if a caller omits the route's early UI guard.
    await assertNotBootstrapTenant(tx, args.tenantId, 'saveTenantModularDraft');
    await acquireTenantApplock(tx, args.tenantId, TENANT_COMMERCIAL_LOCK_PARTS);
    const packState = await getTenantPackState(tx, args.tenantId);
    const pack = packState ? findIndustryPack(packState.packCode) : null;
    if (!pack) throw new ModularDraftError('PACK_NOT_FOUND','مفيش نشاط مجهز لهذه المنشأة',409);
    const selection = validateModularDraftSelection(pack, args);
    const catalogId = await findDraftCatalog(tx, catalogCodeForPack(pack));
    const found = await new sql.Request(tx).input('tenantId',sql.UniqueIdentifier,args.tenantId)
      .query(`SELECT DraftId, BillingCycle, BranchCount, Revision, UpdatedAt
        FROM dbo.TenantModularDraft WITH (UPDLOCK,HOLDLOCK)
        WHERE TenantId=@tenantId AND Status=N'draft';`);
    const current = found.recordset[0] as DraftRow | undefined;
    if (!current && selection.expectedRevision !== null) {
      throw new ModularDraftError('REVISION_CONFLICT','المسودة اتغيرت. حدّث الصفحة الأول.',409);
    }
    if (current && (selection.expectedRevision === null || current.Revision !== selection.expectedRevision)) {
      throw new ModularDraftError('REVISION_CONFLICT','المسودة اتغيرت. حدّث الصفحة الأول.',409);
    }
    const draftId = current ? String(current.DraftId) : randomUUID();
    if (current && Number(current.Revision) >= 2147483647) {
      throw new ModularDraftError('REVISION_EXHAUSTED','لا يمكن تعديل هذه المسودة حاليًا',409);
    }
    const previousApps = current ? await loadDraftApps(tx,args.tenantId,draftId) : [];
    const unchanged = current && current.BillingCycle === selection.billingCycle &&
      Number(current.BranchCount) === selection.branches &&
      previousApps.length===selection.apps.length &&
      previousApps.every((app,i)=>app===selection.apps[i]);
    if (unchanged) {
      await tx.commit();
      return await getTenantModularDraft(args.tenantId);
    }
    const nextRevision = current ? Number(current.Revision)+1 : 1;
    if (current) {
      const write = await new sql.Request(tx)
        .input('tenantId',sql.UniqueIdentifier,args.tenantId)
        .input('draftId',sql.UniqueIdentifier,draftId)
        .input('expectedRevision',sql.Int,selection.expectedRevision)
        .input('cycle',sql.NVarChar(10),selection.billingCycle)
        .input('branches',sql.Int,selection.branches)
        .query(`UPDATE dbo.TenantModularDraft
          SET BillingCycle=@cycle, BranchCount=@branches, Revision=Revision+1, UpdatedAt=SYSUTCDATETIME()
          WHERE DraftId=@draftId AND TenantId=@tenantId AND Status=N'draft' AND Revision=@expectedRevision;
          SELECT @@ROWCOUNT AS changed;`);
      if (Number(write.recordset[0]?.changed)!==1) {
        throw new ModularDraftError('REVISION_CONFLICT','المسودة اتغيرت أثناء الحفظ.',409);
      }
      await new sql.Request(tx).input('tenantId',sql.UniqueIdentifier,args.tenantId)
        .input('draftId',sql.UniqueIdentifier,draftId).query(`
          DELETE a FROM dbo.TenantModularDraftApp a
          INNER JOIN dbo.TenantModularDraft d ON d.DraftId=a.DraftId
          WHERE d.TenantId=@tenantId AND d.DraftId=@draftId AND d.Status=N'draft';`);
    } else {
      await new sql.Request(tx).input('draftId',sql.UniqueIdentifier,draftId)
        .input('tenantId',sql.UniqueIdentifier,args.tenantId)
        .input('catalogId',sql.UniqueIdentifier,catalogId)
        .input('cycle',sql.NVarChar(10),selection.billingCycle)
        .input('branches',sql.Int,selection.branches).query(`
          INSERT INTO dbo.TenantModularDraft
            (DraftId,TenantId,CatalogId,BillingCycle,BranchCount,Revision,Status)
          VALUES (@draftId,@tenantId,@catalogId,@cycle,@branches,1,N'draft');`);
    }
    for (const app of selection.apps) {
      await new sql.Request(tx).input('draftId',sql.UniqueIdentifier,draftId)
        .input('app',sql.NVarChar(64),app).query(`
          INSERT INTO dbo.TenantModularDraftApp (DraftId,AppCode) VALUES (@draftId,@app);`);
    }
    await publishPlatformOutboxEvent(tx, {
      tenantId:args.tenantId, aggregateType:'tenant_modular_draft', aggregateId:draftId,
      eventType:'tenant.modular_draft.saved',
      payload:JSON.stringify({draftId,revision:nextRevision,actorUserId:args.actorUserId,
        apps:selection.apps,branches:selection.branches,billingCycle:selection.billingCycle,
        paid:false,subscriptionChanged:false,installedAppsChanged:false}),
      idempotencyKey:'tenant-modular-draft:'+draftId+':v'+nextRevision,
      correlationId:'tenant:'+args.tenantId, occurredAt:new Date(),
    });
    await tx.commit();
  } catch (error) {
    try { await tx.rollback(); } catch { /* original error wins */ }
    throw error;
  }
  return getTenantModularDraft(args.tenantId);
}

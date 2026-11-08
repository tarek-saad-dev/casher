import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { requirePageAccess, isAuthResult } from '@/lib/api-auth';
import { resolveReportBranchScope, isReportBranchScope } from '@/lib/branch';
import { assertFinanceBranches, financeScopeKey, loadFinanceOverview, type BranchForFinance } from '@/lib/financial-intelligence/data';
import { getCairoCalendarDate } from '@/lib/businessDate';
import { upcomingCommitments, type Commitment, type CommitmentKind, type Frequency } from '@/lib/financial-intelligence/forecast';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const PAGE = '/admin/financial-intelligence';
const KIND = new Set<CommitmentKind>(['rent','payroll','installment','debt','supplier','utilities','other']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: unknown): s is string => typeof s === 'string' && DATE.test(s) && !Number.isNaN(Date.parse(s));
function errorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[financial-intelligence]', message);
  if (/Invalid object name.*TblFinInsight|Invalid column name.*TblFinInsight/i.test(message)) {
    return NextResponse.json({ error: 'يلزم تشغيل ترحيل قاعدة بيانات Financial Intelligence أولًا', code:'FINANCE_SCHEMA_REQUIRED' }, {status:503});
  }
  return NextResponse.json({error:'تعذر تنفيذ العملية المالية. راجع سجل السيرفر.'},{status:500});
}
async function permittedScope(req: NextRequest, explicitBranchId?: number) {
  const sp = new URL(req.url).searchParams;
  const branchId = explicitBranchId ?? (sp.get('branchId') ? Number(sp.get('branchId')) : null);
  const scope = await resolveReportBranchScope({
    requestedBranchId: branchId,
    requestedAllBranches: explicitBranchId ? false : sp.get('scope') === 'all',
    allowAllBranchesIfPermitted: true,
  });
  if (!isReportBranchScope(scope)) return scope;
  const branches: BranchForFinance[] = scope.mode==='all'
    ? scope.branches.map(b=>({branchId:b.branchId,branchName:b.branchName,branchCode:b.branchCode}))
    : [{branchId:scope.branchId,branchName:scope.branchName,branchCode:scope.branchCode}];
  if (explicitBranchId && (branches.length !== 1 || branches[0].branchId !== explicitBranchId)) {
    return NextResponse.json({error:'هذا الفرع غير مصرح به'},{status:403});
  }
  return branches;
}

export async function GET(req: NextRequest) {
  const auth = await requirePageAccess(PAGE);
  if (!isAuthResult(auth)) return auth;
  const scope = await permittedScope(req);
  if (scope instanceof NextResponse) return scope;
  try {
    const today = getCairoCalendarDate();
    const data = await loadFinanceOverview(auth.tenantId, scope, today);
    return NextResponse.json({ok:true, data}, {headers:{'Cache-Control':'no-store'}});
  } catch(err) { return errorResponse(err); }
}

export async function POST(req: NextRequest) {
  const auth = await requirePageAccess(PAGE);
  if (!isAuthResult(auth)) return auth;
  if (!auth.isSuperAdmin && !auth.roles.some(x=>['admin','accountant'].includes(x))) {
    return NextResponse.json({error:'تسجيل أو تسوية الالتزامات متاح للإدارة المالية فقط'},{status:403});
  }
  let body: Record<string,unknown>;
  try { body = await req.json() as Record<string,unknown>; }
  catch { return NextResponse.json({error:'بيانات الطلب غير صحيحة'},{status:400}); }
  const action = String(body.action || '');
  if (action==='add') {
    const branchId=Number(body.branchId);
    if (!Number.isInteger(branchId) || branchId<1) return NextResponse.json({error:'اختر الفرع'},{status:400});
    const scope=await permittedScope(req,branchId);
    if (scope instanceof NextResponse) return scope;
    const title=String(body.title || '').trim();
    const kind=String(body.kind || '') as CommitmentKind;
    const amount=Number(body.amount);
    const dueDate=body.dueDate;
    const frequency=String(body.frequency || '') as Frequency;
    const endDate=body.endDate === null || body.endDate === '' ? null : body.endDate;
    if (title.length<2 || title.length>160 || !KIND.has(kind) || !Number.isFinite(amount) || amount<=0 || amount>100000000
      || !validDate(dueDate) || !['once','monthly'].includes(frequency)
      || (endDate!==null && (!validDate(endDate) || endDate<dueDate))) {
      return NextResponse.json({error:'راجع اسم الالتزام ونوعه والمبلغ وتاريخ الاستحقاق'},{status:400});
    }
    try {
      await assertFinanceBranches(auth.tenantId,scope);
      const db=await getPool();
      const r=await db.request()
        .input('tenant',sql.UniqueIdentifier,auth.tenantId)
        .input('branch',sql.Int,branchId)
        .input('title',sql.NVarChar(160),title)
        .input('kind',sql.NVarChar(30),kind)
        .input('amount',sql.Decimal(18,2),amount)
        .input('due',sql.Date,dueDate)
        .input('frequency',sql.VarChar(10),frequency)
        .input('end',sql.Date,endDate)
        .input('actor',sql.Int,auth.userId)
        .query('INSERT INTO dbo.TblFinInsightCommitment (TenantId,BranchID,Title,Kind,Amount,DueDate,Frequency,EndDate,CreatedByUserID) OUTPUT INSERTED.ID VALUES (@tenant,@branch,@title,@kind,@amount,@due,@frequency,@end,@actor)');
      return NextResponse.json({ok:true,id:Number(r.recordset[0]?.ID)},{status:201});
    } catch(err){return errorResponse(err);}
  }
  if (action==='settle') {
    const branchId=Number(body.branchId), commitmentId=Number(body.commitmentId), amount=Number(body.amount);
    const dueDate=body.dueDate;
    if (![branchId,commitmentId].every(n=>Number.isInteger(n)&&n>0)
      || !validDate(dueDate) || !Number.isFinite(amount) || amount<=0 || amount>100000000) {
      return NextResponse.json({error:'قيمة السداد أو الاستحقاق غير صحيحة'},{status:400});
    }
    const scope=await permittedScope(req,branchId);
    if (scope instanceof NextResponse) return scope;
    try {
      await assertFinanceBranches(auth.tenantId,scope);
      const db=await getPool();
      const tx=new sql.Transaction(db);
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        const owned=await new sql.Request(tx)
          .input('id',sql.Int,commitmentId).input('tenant',sql.UniqueIdentifier,auth.tenantId)
          .input('branch',sql.Int,branchId)
          .query('SELECT ID,BranchID,Title,Kind,Amount,DueDate,Frequency,EndDate FROM dbo.TblFinInsightCommitment WITH (UPDLOCK,HOLDLOCK) WHERE ID=@id AND TenantId=@tenant AND BranchID=@branch AND IsActive=1');
        const r=owned.recordset[0] as Record<string,unknown>|undefined;
        if(!r) {await tx.rollback();return NextResponse.json({error:'الالتزام غير موجود'},{status:404});}
        const d=(v:unknown)=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
        const c:Commitment={
          id:Number(r.ID),branchId:Number(r.BranchID),title:String(r.Title),kind:String(r.Kind) as CommitmentKind,
          amount:Number(r.Amount),dueDate:d(r.DueDate),frequency:String(r.Frequency) as Frequency,endDate:r.EndDate?d(r.EndDate):null,
        };
        if(!upcomingCommitments([c],[],dueDate,0).some(item=>item.occurrenceDate===dueDate)) {
          await tx.rollback();return NextResponse.json({error:'تاريخ القسط لا يطابق الجدول المسجل'},{status:400});
        }
        const sums=await new sql.Request(tx).input('id',sql.Int,commitmentId).input('due',sql.Date,dueDate)
          .query('SELECT COALESCE(SUM(Amount),0) AS Paid FROM dbo.TblFinInsightSettlement WITH (UPDLOCK,HOLDLOCK) WHERE CommitmentID=@id AND DueDate=@due');
        const paid=Number(sums.recordset[0]?.Paid || 0);
        if(Math.round((paid+amount)*100)>Math.round(c.amount*100)){
          await tx.rollback();return NextResponse.json({error:'السداد يزيد عن قيمة الاستحقاق المتبقية'},{status:409});
        }
        await new sql.Request(tx).input('id',sql.Int,commitmentId).input('due',sql.Date,dueDate)
          .input('amount',sql.Decimal(18,2),amount).input('actor',sql.Int,auth.userId)
          .query('INSERT INTO dbo.TblFinInsightSettlement(CommitmentID,DueDate,Amount,CreatedByUserID) VALUES(@id,@due,@amount,@actor)');
        await tx.commit();
        return NextResponse.json({ok:true,warning:'تم تسجيل حالة سداد الالتزام فقط؛ لم يتم إنشاء حركة خزنة أو خصم رصيد جديد.'});
      }catch(err){await tx.rollback();throw err;}
    }catch(err){return errorResponse(err);}
  }
  if (action==='snapshot') {
    const scope=await permittedScope(req);
    if(scope instanceof NextResponse) return scope;
    const today=getCairoCalendarDate();
    try {
      const overview=await loadFinanceOverview(auth.tenantId,scope,today);
      const db=await getPool();
      await db.request().input('tenant',sql.UniqueIdentifier,auth.tenantId)
        .input('scope',sql.NVarChar(200),financeScopeKey(scope))
        .input('day',sql.Date,today).input('payload',sql.NVarChar(sql.MAX),JSON.stringify(overview))
        .input('actor',sql.Int,auth.userId)
        .query('INSERT INTO dbo.TblFinInsightSnapshot(TenantId,ScopeKey,AsOfDate,Payload,CreatedByUserID) VALUES(@tenant,@scope,@day,@payload,@actor)');
      return NextResponse.json({ok:true,asOf:today},{status:201});
    }catch(err){
      if(err instanceof Error && /UNIQUE KEY|duplicate key/i.test(err.message))
        return NextResponse.json({error:'تم حفظ لقطة لهذا اليوم والنطاق بالفعل. لن نستبدل التقرير التاريخي.'},{status:409});
      return errorResponse(err);
    }
  }
  return NextResponse.json({error:'الإجراء غير معروف'},{status:400});
}

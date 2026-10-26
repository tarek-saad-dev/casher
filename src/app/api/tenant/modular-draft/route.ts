import { NextResponse } from 'next/server';
import { isAuthResult } from '@/lib/api-auth';
import { requireTenantBillingAdmin } from '@/platform/commercial/tenantBillingAuth';
import { getTenantModularDraft, saveTenantModularDraft } from '@/platform/commercial/modularDraftService';
import { ModularDraftError } from '@/platform/commercial/modularDraftPolicy';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const HEADERS={'Cache-Control':'no-store'};
function handleError(error: unknown): NextResponse {
  if (error instanceof ModularDraftError) {
    return NextResponse.json({error:error.message,code:error.code,paid:false,
      subscriptionChanged:false}, {status:error.status,headers:HEADERS});
  }
  console.error('[tenant-modular-draft]',error instanceof Error ? error.message : error);
  return NextResponse.json({error:'تعذر تحميل أو حفظ مسودة التطبيقات',code:'DRAFT_UNAVAILABLE',
    paid:false,subscriptionChanged:false},{status:503,headers:HEADERS});
}

/** Read tenant-scoped commercial planning data, even after trial expiry. */
export async function GET() {
  const auth=await requireTenantBillingAdmin();
  if (!isAuthResult(auth)) return auth;
  try {
    const state=await getTenantModularDraft(auth.tenantId);
    return NextResponse.json({...state,protectedTenant:auth.tenant.tenantCode==='CASHER_BOOT'}, {headers:HEADERS});
  } catch (error) {return handleError(error);}
}

/** Planning only: no tenantId, amount, catalogId, paid, status or entitlement accepted. */
export async function PUT(req: Request) {
  const auth=await requireTenantBillingAdmin();
  if (!isAuthResult(auth)) return auth;
  if (auth.tenant.tenantCode==='CASHER_BOOT') {
    return NextResponse.json({error:'حساب CUT الأساسي محمي من تعديل اختيارات الاشتراك',
      code:'BOOTSTRAP_TENANT_PROTECTED',paid:false,subscriptionChanged:false},
      {status:409,headers:HEADERS});
  }
  let input: {apps:string[];branches:number;billingCycle:'monthly'|'annual';expectedRevision:number|null};
  try {
    const body:unknown=await req.json();
    if (!body || typeof body!=='object' || Array.isArray(body)) throw Error('invalid');
    const x=body as Record<string,unknown>;
    const allowed=['apps','branches','billingCycle','expectedRevision'];
    if (Object.keys(x).some(k=>!allowed.includes(k)) || allowed.some(k=>!Object.hasOwn(x,k)) ||
        !Array.isArray(x.apps) || x.apps.length>12 || x.apps.some(a=>typeof a!=='string') ||
        !Number.isSafeInteger(x.branches) ||
        (x.billingCycle!=='monthly'&&x.billingCycle!=='annual') ||
        !(x.expectedRevision===null || (Number.isSafeInteger(x.expectedRevision)&&Number(x.expectedRevision)>=1))) {
      throw Error('invalid');
    }
    input={apps:x.apps as string[],branches:Number(x.branches),
      billingCycle:x.billingCycle as 'monthly'|'annual',
      expectedRevision:x.expectedRevision as number|null};
  } catch {
    return NextResponse.json({error:'بيانات المسودة غير صحيحة',code:'INVALID_REQUEST',
      paid:false,subscriptionChanged:false},{status:400,headers:HEADERS});
  }
  try {
    const state=await saveTenantModularDraft({tenantId:auth.tenantId,
      actorUserId:auth.userId,...input});
    return NextResponse.json({...state,protectedTenant:false,paid:false,subscriptionChanged:false,
      installedAppsChanged:false}, {headers:HEADERS});
  } catch (error) {return handleError(error);}
}

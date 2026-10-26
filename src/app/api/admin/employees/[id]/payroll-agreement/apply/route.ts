import { NextRequest, NextResponse } from 'next/server';
import { requirePageAccess, isAuthResult } from '@/lib/api-auth';
import { requireMasterDataTenantId } from '@/platform/masterData/tenantScope';
import { applyRetroVip } from '@/lib/payroll/retroactiveAgreementApply';
import type { RetroInput } from '@/lib/payroll/retroactiveAgreementPreview';

type Context = { params: Promise<{id:string}> };

export async function POST(request:NextRequest, {params}:Context) {
  if(process.env.PAYROLL_RETROACTIVE_ENABLED!=='true') {
    return NextResponse.json({error:'التسوية بأثر رجعي لم تُفعَّل بعد على الخادم'},{status:503});
  }
  try {
    const auth=await requirePageAccess('/admin/hr');
    if(!isAuthResult(auth)) return auth;
    const {id}=await params;
    const empId=Number(id);
    if(!Number.isSafeInteger(empId)||empId<1) return NextResponse.json({error:'موظف غير صالح'},{status:400});
    // Financial rollout safety: a production flag alone must never expose
    // retroactive settlement for every employee. Explicitly allowlist IDs.
    if (process.env.NODE_ENV === 'production') {
      const allowlist = String(process.env.PAYROLL_RETROACTIVE_EMPLOYEE_IDS || '')
        .split(',')
        .map(value => value.trim())
        .filter(value => /^[1-9][0-9]*$/.test(value))
        .map(Number);
      if (!allowlist.includes(empId)) {
        return NextResponse.json(
          { error: 'التسوية بأثر رجعي غير مفعلة لهذا الموظف' },
          { status: 403 },
        );
      }
    }
    const tenantId=requireMasterDataTenantId(auth.tenantId,'retroactive payroll apply');
    const input=(await request.json()) as RetroInput;
    const result=await applyRetroVip({empId,tenantId,userId:auth.userId,input});
    return NextResponse.json(result);
  } catch(err:unknown) {
    console.error('[retroactive payroll apply]',err);
    const message=err instanceof Error?err.message:'تعذر اعتماد التسوية';
    const status=/موجود|التسوية|مرحّل|مزدوج|قديمة|اتفاق|تغيرت/.test(message)?409:400;
    return NextResponse.json({error:message},{status});
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { requirePageAccess, isAuthResult } from '@/lib/api-auth';
import { requireMasterDataTenantId } from '@/platform/masterData/tenantScope';
import { previewRetroVip, type RetroInput } from '@/lib/payroll/retroactiveAgreementPreview';

type Context = { params: Promise<{id:string}> };

export async function POST(request:NextRequest, {params}:Context) {
  try {
    const auth=await requirePageAccess('/admin/hr');
    if(!isAuthResult(auth)) return auth;
    const {id}=await params;
    const empId=Number(id);
    if(!Number.isSafeInteger(empId)||empId<1) return NextResponse.json({error:'موظف غير صالح'},{status:400});
    const tenantId=requireMasterDataTenantId(auth.tenantId,'retroactive payroll preview');
    const input=(await request.json()) as RetroInput;
    const preview=await previewRetroVip({empId,tenantId,input});
    return NextResponse.json({success:true,preview});
  } catch(err:unknown) {
    console.error('[retroactive payroll preview]',err);
    return NextResponse.json({error:err instanceof Error?err.message:'تعذر معاينة الاتفاقية'},{status:400});
  }
}

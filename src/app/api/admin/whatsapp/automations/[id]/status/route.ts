import { NextRequest,NextResponse } from 'next/server';
import {getPool,sql} from '@/lib/db';
import {requireWhatsAppTemplateAdmin,isWhatsAppTemplateAdmin} from '../../../templates/access';
import {parseAutomationDefinition} from '@/modules/messaging/automation/draftRules';
export const runtime='nodejs';
export async function PATCH(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 const auth=await requireWhatsAppTemplateAdmin();if(!isWhatsAppTemplateAdmin(auth))return auth;
 const {id}=await params;const numericId=Number(id);
 if(!Number.isSafeInteger(numericId)||numericId<=0)return NextResponse.json({error:'معرف غير صالح'},{status:400});
 let desired:'active'|'paused';try{const b=await request.json();if(b.status!=='active'&&b.status!=='paused')throw Error();desired=b.status;}catch{return NextResponse.json({error:'حالة غير صحيحة'},{status:400});}
 try{
  const db=await getPool();const tx=new sql.Transaction(db);await tx.begin();
  try{
   const rq=new sql.Request(tx).input('id',sql.Int,numericId).input('tenant',sql.NVarChar(100),auth.tenantId).input('branch',sql.Int,auth.branchId).input('user',sql.Int,auth.userId);
   const row=await rq.query("SELECT DefinitionJson,Status FROM dbo.TblCutPulseAutomationDraft WITH (UPDLOCK,ROWLOCK) WHERE ID=@id AND TenantId=@tenant AND BranchID=@branch AND CreatedByUserID=@user");
   if(!row.recordset.length){await tx.rollback();return NextResponse.json({error:'المسودة غير موجودة'},{status:404});}
   parseAutomationDefinition(JSON.parse(row.recordset[0].DefinitionJson));
   await new sql.Request(tx).input('id',sql.Int,numericId).input('tenant',sql.NVarChar(100),auth.tenantId).input('branch',sql.Int,auth.branchId).input('user',sql.Int,auth.userId).input('status',sql.NVarChar(20),desired)
   .query("UPDATE dbo.TblCutPulseAutomationDraft SET Status=@status,Version=Version+1,UpdatedAt=SYSUTCDATETIME() WHERE ID=@id AND TenantId=@tenant AND BranchID=@branch AND CreatedByUserID=@user");
   await tx.commit();return NextResponse.json({ok:true,status:desired,dispatchEnabled:false});
  }catch(e){await tx.rollback();throw e;}
 }catch(e){console.error('[cut-pulse status]',e);return NextResponse.json({error:'تعذر تغيير الحالة'},{status:503});}
}

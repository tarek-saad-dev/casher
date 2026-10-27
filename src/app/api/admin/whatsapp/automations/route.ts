import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { requireWhatsAppTemplateAdmin, isWhatsAppTemplateAdmin } from '../templates/access';
import { parseAutomationDefinition } from '@/modules/messaging/automation/draftRules';
export const runtime='nodejs';
export async function GET(){
 const auth=await requireWhatsAppTemplateAdmin();if(!isWhatsAppTemplateAdmin(auth))return auth;
 try{
 const db=await getPool();
 const r=await db.request().input('tenant',sql.NVarChar(100),auth.tenantId).input('branch',sql.Int,auth.branchId).input('user',sql.Int,auth.userId)
 .query("SELECT ID, Name, DefinitionJson, Version, UpdatedAt FROM dbo.TblCutPulseAutomationDraft WHERE TenantId=@tenant AND BranchID=@branch AND CreatedByUserID=@user AND Status=N'draft' ORDER BY UpdatedAt DESC");
 return NextResponse.json({drafts:r.recordset.map(x=>({id:String(x.ID),name:x.Name,definition:JSON.parse(x.DefinitionJson),version:x.Version,updatedAt:x.UpdatedAt}))});
 }catch(e){console.error('[cut-pulse GET]',e);return NextResponse.json({error:'تعذر تحميل المسودات؛ تحقق من تشغيل Migration'}, {status:503});}
}
export async function POST(req:NextRequest){
 const auth=await requireWhatsAppTemplateAdmin();if(!isWhatsAppTemplateAdmin(auth))return auth;
 try{
 const def=parseAutomationDefinition(await req.json());
 const db=await getPool();
 const r=await db.request().input('tenant',sql.NVarChar(100),auth.tenantId).input('branch',sql.Int,auth.branchId).input('user',sql.Int,auth.userId).input('name',sql.NVarChar(160),def.name).input('json',sql.NVarChar(sql.MAX),JSON.stringify(def)).query("INSERT INTO dbo.TblCutPulseAutomationDraft (TenantId,BranchID,CreatedByUserID,Name,DefinitionJson) OUTPUT INSERTED.ID VALUES(@tenant,@branch,@user,@name,@json)");
 return NextResponse.json({ok:true,id:String(r.recordset[0].ID),status:'draft'}, {status:201});
 }catch(e){const invalid=e instanceof Error&&!/SQL|RequestError/.test(e.name);console.error('[cut-pulse POST]',e);return NextResponse.json({error:invalid?(e as Error).message:'تعذر حفظ المسودة'}, {status:invalid?400:503});}
}

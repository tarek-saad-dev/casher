import {decemberProductionConfigured} from '@/lib/campaigns/december-exam/releaseMode';
import { NextRequest,NextResponse } from 'next/server';
import { requireAdmin,isAuthResult } from '@/lib/api-auth';
import { getPool,sql } from '@/lib/db';
import { validateRates,type DecemberRates } from '@/lib/campaigns/december-exam/rules';
import { DECEMBER_CAMPAIGN_CODE } from '@/lib/campaigns/december-exam/registrationRepository';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private,no-store','X-Robots-Tag':'noindex'}});
const enabled=(tenant:string)=>process.env.DECEMBER_EXAM_STAFF_ENABLED==='true'&&tenant.toLowerCase()===process.env.DECEMBER_EXAM_TENANT_ID?.toLowerCase();
export async function GET(){
 const staff=await requireAdmin();if(!isAuthResult(staff))return staff;
 if(!enabled(staff.tenantId))return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);
 try{
  const r=await (await getPool()).request().input('tenant',sql.UniqueIdentifier,staff.tenantId)
   .input('code',sql.VarChar(48),DECEMBER_CAMPAIGN_CODE).query(`
   SELECT Code,Status,StartsAtUtc,EndsAtUtc,FirstVisitPct,StudentPct,ClubPct,MultiServicePct,Friend1Pct,Friend2Pct,Friend3Pct
   FROM dbo.CutOfferCampaign WHERE TenantId=@tenant AND Code=@code
  `);
  return reply({ok:true,campaign:r.recordset[0]??null,productionConfigured:decemberProductionConfigured()});
 }catch{return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);}
}
export async function POST(req:NextRequest){
 const origin=process.env.DECEMBER_EXAM_CASHER_PUBLIC_ORIGIN||(process.env.NODE_ENV==='production'?'https://ops.cutsaloon.com':req.nextUrl.origin);
 if(req.headers.get('origin')!==origin||!req.headers.get('content-type')?.startsWith('application/json'))return reply({ok:false,code:'ORIGIN_REQUIRED'},403);
 const staff=await requireAdmin();if(!isAuthResult(staff))return staff;
 if(!enabled(staff.tenantId))return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);
 const body=await req.json().catch(()=>null);
 const rates:DecemberRates={firstVisit:body?.firstVisit,student:body?.student,club:body?.club,multiService:body?.multiService,friends:body?.friends};
 try{if(!Array.isArray(rates.friends))throw Error('INVALID');validateRates(rates);}catch{return reply({ok:false,code:'INVALID_RATES'},400);}
 try{
  const tx=new sql.Transaction(await getPool());await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try{
   const request=()=>new sql.Request(tx).input('tenant',sql.UniqueIdentifier,staff.tenantId).input('code',sql.VarChar(48),DECEMBER_CAMPAIGN_CODE);
   const existing=await request().query<{Status:string}>(`SELECT Status FROM dbo.CutOfferCampaign WITH(UPDLOCK,HOLDLOCK) WHERE TenantId=@tenant AND Code=@code`);
   if(existing.recordset[0]&&existing.recordset[0].Status!=='DRAFT'){await tx.rollback();return reply({ok:false,code:'CAMPAIGN_LOCKED'},409);}
   const write=request().input('first',sql.TinyInt,rates.firstVisit).input('student',sql.TinyInt,rates.student)
    .input('club',sql.TinyInt,rates.club).input('multi',sql.TinyInt,rates.multiService)
    .input('f1',sql.TinyInt,rates.friends[0]).input('f2',sql.TinyInt,rates.friends[1]).input('f3',sql.TinyInt,rates.friends[2])
    .input('start',sql.DateTime2,new Date('2026-11-30T22:00:00Z')).input('end',sql.DateTime2,new Date('2026-12-31T22:00:00Z'));
   await write.query(existing.recordset.length?`
    UPDATE dbo.CutOfferCampaign SET FirstVisitPct=@first,StudentPct=@student,ClubPct=@club,MultiServicePct=@multi,
      Friend1Pct=@f1,Friend2Pct=@f2,Friend3Pct=@f3,StartsAtUtc=@start,EndsAtUtc=@end
    WHERE TenantId=@tenant AND Code=@code AND Status='DRAFT'
   `:`
    INSERT dbo.CutOfferCampaign(TenantId,Code,Status,StartsAtUtc,EndsAtUtc,FirstVisitPct,StudentPct,ClubPct,MultiServicePct,Friend1Pct,Friend2Pct,Friend3Pct)
    VALUES(@tenant,@code,'DRAFT',@start,@end,@first,@student,@club,@multi,@f1,@f2,@f3)
   `);
   await tx.commit();return reply({ok:true,status:'DRAFT'});
  }catch(e){await tx.rollback().catch(()=>null);throw e;}
 }catch{return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);}
}

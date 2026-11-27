import {decemberProductionConfigured,decemberProductionLogin} from '@/lib/campaigns/december-exam/releaseMode';
import {requireStagingZeroPayment} from '@/lib/campaigns/december-exam/stagingZeroPayment';
import {NextRequest,NextResponse} from 'next/server';
import {requireAdmin,isAuthResult} from '@/lib/api-auth';
import {getPool,sql} from '@/lib/db';
import {DECEMBER_CAMPAIGN_CODE} from '@/lib/campaigns/december-exam/registrationRepository';
import {nextCampaignStatus,type CampaignStatus,type CampaignAction} from '@/lib/campaigns/december-exam/lifecycle';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private,no-store','X-Robots-Tag':'noindex'}});
export async function POST(req:NextRequest){
 const origin=process.env.DECEMBER_EXAM_CASHER_PUBLIC_ORIGIN||(process.env.NODE_ENV==='production'?'https://ops.cutsaloon.com':req.nextUrl.origin);
 if(req.headers.get('origin')!==origin||!req.headers.get('content-type')?.startsWith('application/json'))return reply({ok:false,code:'ORIGIN_REQUIRED'},403);
 const auth=await requireAdmin();if(!isAuthResult(auth))return auth;
 if(process.env.DECEMBER_EXAM_STAFF_ENABLED!=='true'||auth.tenantId.toLowerCase()!==process.env.DECEMBER_EXAM_TENANT_ID?.toLowerCase())return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);
 const b=await req.json().catch(()=>null);
 const reason=typeof b?.reason==='string'?b.reason.trim():'';
 if(!b||!['ACTIVATE','PAUSE','RESUME','END'].includes(b.action)||reason.length<5||reason.length>300||b.confirm!==true)return reply({ok:false,code:'INVALID_REQUEST'},400);
 try{
  const tx=new sql.Transaction(await getPool());await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try{
   const q=()=>new sql.Request(tx).input('tenant',sql.UniqueIdentifier,auth.tenantId).input('code',sql.VarChar(48),DECEMBER_CAMPAIGN_CODE);
   const r=await q().input('productionLogin',sql.NVarChar(128),decemberProductionLogin()).query<{CampaignId:string;Status:CampaignStatus;InWindow:number;IsStaging:number;IsProduction:number;MaxPct:number}>(`
   SELECT c.CampaignId,c.Status,CASE WHEN c.StartsAtUtc<=SYSUTCDATETIME() AND c.EndsAtUtc>SYSUTCDATETIME() THEN 1 ELSE 0 END InWindow,
   CASE WHEN DB_NAME()=N'last132_agent' AND SUSER_SNAME()=N'drvo_agent' AND t.Code=N'CASHER_BOOT' THEN 1 ELSE 0 END IsStaging,
   CASE WHEN DB_NAME()=N'last132' AND @productionLogin IS NOT NULL AND SUSER_SNAME()=@productionLogin AND t.Code=N'CASHER_BOOT' THEN 1 ELSE 0 END IsProduction,
   CAST(c.FirstVisitPct AS int)+c.StudentPct+c.ClubPct+c.MultiServicePct+c.Friend3Pct MaxPct
   FROM dbo.CutOfferCampaign c WITH(UPDLOCK,HOLDLOCK) JOIN dbo.Tenant t ON t.TenantId=c.TenantId AND t.Status=N'active'
   WHERE c.TenantId=@tenant AND c.Code=@code
   `);
   const row=r.recordset[0];
   if(!row){await tx.rollback();return reply({ok:false,code:'NOT_FOUND'},404);}
   let ready=row.IsStaging===1&&process.env.DECEMBER_EXAM_STAGING_LIFECYCLE_ENABLED==='true'&&process.env.DECEMBER_EXAM_STAGING_CHECKOUT_ENABLED==='true'&&process.env.DECEMBER_EXAM_STAGING_REFERRAL_ENABLED==='true';
   if(row.IsProduction===1&&decemberProductionConfigured()){
    const ids=(process.env.DECEMBER_EXAM_ELIGIBLE_SERVICE_IDS||'').split(',').map(Number);
    ready=ids.length>0&&ids.length<=100&&ids.every(n=>Number.isSafeInteger(n)&&n>0&&n<=2147483647)
      &&process.env.DECEMBER_EXAM_INTERNAL_REGISTRATION_ENABLED==='true'&&process.env.DECEMBER_EXAM_POS_PREVIEW_ENABLED==='true';
    if(ready){
     const unique=[...new Set(ids)];
     const catalog=await q().query<{n:number}>(`SELECT COUNT(*) n FROM dbo.TblPro p JOIN dbo.TblCat c ON c.CatID=p.CatID AND c.TenantId=p.TenantId WHERE p.TenantId=@tenant AND ISNULL(p.isDeleted,0)=0 AND ISNULL(c.CatType,'')<>'pro' AND p.SPrice1>0 AND p.ProID IN (${unique.join(',')})`);
     ready=catalog.recordset[0]?.n===unique.length;
    }
    if(ready&&row.MaxPct>=100){try{await requireStagingZeroPayment(tx);}catch{ready=false;}}
   }
   const next=nextCampaignStatus(row.Status,b.action as CampaignAction,row.InWindow===1,ready);
   if(!next){await tx.rollback();return reply({ok:false,code:'TRANSITION_BLOCKED'},409);}
   const changed=await q().input('status',sql.VarChar(12),next).input('previous',sql.VarChar(12),row.Status).query('UPDATE dbo.CutOfferCampaign SET Status=@status WHERE TenantId=@tenant AND Code=@code AND Status=@previous');
   if(changed.rowsAffected[0]!==1)throw Error('STATE_CONFLICT');
   await new sql.Request(tx).input('tenant',sql.UniqueIdentifier,auth.tenantId).input('campaign',sql.UniqueIdentifier,row.CampaignId).input('user',sql.Int,auth.userId).input('action',sql.VarChar(32),b.action).input('reason',sql.NVarChar(300),reason).query('INSERT dbo.CutOfferOperationAudit(TenantId,CampaignId,ActorUserId,ActionCode,Reason) VALUES(@tenant,@campaign,@user,@action,@reason)');
   await tx.commit();return reply({ok:true,status:next});
  }catch(e){await tx.rollback().catch(()=>null);throw e;}
 }catch{return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);}
}

import {randomBytes} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {requireAdmin,isAuthResult} from '@/lib/api-auth';
import {getPool,sql} from '@/lib/db';
import {campaignSessionDigest,DECEMBER_CAMPAIGN_CODE} from '@/lib/campaigns/december-exam/registrationRepository';
import {normalizeEgyptianMobile} from '@/lib/campaigns/december-exam/registration';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private,no-store','X-Robots-Tag':'noindex'}});
export async function POST(req:NextRequest){
 const origin=process.env.DECEMBER_EXAM_CASHER_PUBLIC_ORIGIN||(process.env.NODE_ENV==='production'?'https://ops.cutsaloon.com':req.nextUrl.origin);
 if(req.headers.get('origin')!==origin||!req.headers.get('content-type')?.startsWith('application/json'))return reply({ok:false,code:'ORIGIN_REQUIRED'},403);
 const auth=await requireAdmin();if(!isAuthResult(auth))return auth;
 if(process.env.DECEMBER_EXAM_STAFF_ENABLED!=='true'||auth.tenantId.toLowerCase()!==process.env.DECEMBER_EXAM_TENANT_ID?.toLowerCase())return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);
 const b=await req.json().catch(()=>null),reason=typeof b?.reason==='string'?b.reason.trim():'';
 if(!b||typeof b.participantId!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(b.participantId)||b.confirmedInPerson!==true||reason.length<5||reason.length>300)return reply({ok:false,code:'INVALID_REQUEST'},400);
 try{
 const tx=new sql.Transaction(await getPool());await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{
 const q=()=>new sql.Request(tx).input('tenant',sql.UniqueIdentifier,auth.tenantId).input('participant',sql.UniqueIdentifier,b.participantId).input('code',sql.VarChar(48),DECEMBER_CAMPAIGN_CODE);
 const r=await q().query<{CampaignId:string;PhoneNormalized:string;Mobile:string}>(`
 SELECT c.CampaignId,p.PhoneNormalized,cl.Mobile FROM dbo.CutOfferParticipant p WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.CutOfferCampaign c ON c.TenantId=p.TenantId AND c.CampaignId=p.CampaignId
 JOIN dbo.TblClient cl WITH(HOLDLOCK) ON cl.TenantId=p.TenantId AND cl.ClientID=p.ClientId
 WHERE p.TenantId=@tenant AND p.ParticipantId=@participant AND c.Code=@code AND c.Status='ACTIVE'
 AND c.StartsAtUtc<=SYSUTCDATETIME() AND c.EndsAtUtc>SYSUTCDATETIME()
 AND p.CreatedAtUtc>DATEADD(day,-31,SYSUTCDATETIME()) AND p.IdentityVerifiedAtUtc IS NOT NULL
 `);
 const p=r.recordset[0];let match=false;try{match=!!p&&normalizeEgyptianMobile(p.Mobile)===p.PhoneNormalized;}catch{/* reject */}
 if(!p||!match){await tx.rollback();return reply({ok:false,code:'IDENTITY_REVIEW_REQUIRED'},409);}
 const token=randomBytes(32).toString('base64url');
 const updated=await q().input('campaign',sql.UniqueIdentifier,p.CampaignId).input('digest',sql.Char(64),campaignSessionDigest(token)).query('UPDATE dbo.CutOfferParticipant SET SessionDigest=@digest WHERE TenantId=@tenant AND CampaignId=@campaign AND ParticipantId=@participant');
 if(updated.rowsAffected[0]!==1)throw Error('RECOVERY_CONFLICT');
 await q().input('campaign',sql.UniqueIdentifier,p.CampaignId).input('user',sql.Int,auth.userId).input('reason',sql.NVarChar(300),reason).query("INSERT dbo.CutOfferOperationAudit(TenantId,CampaignId,ParticipantId,ActorUserId,ActionCode,Reason) VALUES(@tenant,@campaign,@participant,@user,'RECOVER_SESSION',@reason)");
 await tx.commit();
 // Deliver privately in person. Never log the token or include in a query string.
 return reply({ok:true,recoveryToken:token});
 }catch(e){await tx.rollback().catch(()=>null);throw e;}
 }catch{return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);}
}

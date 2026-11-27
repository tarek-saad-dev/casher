import {createHash,timingSafeEqual} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {getPool,sql} from '@/lib/db';
import {DECEMBER_CAMPAIGN_CODE} from '@/lib/campaigns/december-exam/registrationRepository';
import {validateRates,type DecemberRates} from '@/lib/campaigns/december-exam/rules';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private,no-store','X-Robots-Tag':'noindex'}});
const digest=(v:string)=>createHash('sha256').update(v).digest();
export async function GET(req:NextRequest){
 if(process.env.DECEMBER_EXAM_INTERNAL_REGISTRATION_ENABLED!=='true')return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);
 const key=process.env.DECEMBER_EXAM_BFF_SHARED_KEY,tenant=process.env.DECEMBER_EXAM_TENANT_ID,auth=req.headers.get('authorization');
 if(!key||Buffer.byteLength(key)<32||!tenant||!auth?.startsWith('Bearer ')||!timingSafeEqual(digest(key),digest(auth.slice(7))))return reply({ok:false,code:'UNAUTHORIZED'},401);
 try{
 const r=await (await getPool()).request().input('tenant',sql.UniqueIdentifier,tenant).input('code',sql.VarChar(48),DECEMBER_CAMPAIGN_CODE)
 .query<{FirstVisitPct:number;StudentPct:number;ClubPct:number;MultiServicePct:number;Friend1Pct:number;Friend2Pct:number;Friend3Pct:number}>(`
 SELECT c.FirstVisitPct,c.StudentPct,c.ClubPct,c.MultiServicePct,c.Friend1Pct,c.Friend2Pct,c.Friend3Pct
 FROM dbo.CutOfferCampaign c JOIN dbo.Tenant t ON t.TenantId=c.TenantId AND t.Status=N'active'
 WHERE c.TenantId=@tenant AND c.Code=@code AND c.Status='ACTIVE' AND c.StartsAtUtc<=SYSUTCDATETIME() AND c.EndsAtUtc>SYSUTCDATETIME()
 `);
 const f=r.recordset[0];if(!f)return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);
 const rates:DecemberRates={firstVisit:f.FirstVisitPct,student:f.StudentPct,club:f.ClubPct,multiService:f.MultiServicePct,friends:[f.Friend1Pct,f.Friend2Pct,f.Friend3Pct]};
 validateRates(rates);return reply({ok:true,rates});
 }catch{return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);}
}

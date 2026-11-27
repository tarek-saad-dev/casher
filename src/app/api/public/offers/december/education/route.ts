import {createHash,timingSafeEqual} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {getPool,sql} from '@/lib/db';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private,no-store','X-Robots-Tag':'noindex'}});
const digest=(v:string)=>createHash('sha256').update(v).digest();
export async function GET(req:NextRequest){
 if(process.env.DECEMBER_EXAM_INTERNAL_REGISTRATION_ENABLED!=='true')return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);
 const key=process.env.DECEMBER_EXAM_BFF_SHARED_KEY,tenant=process.env.DECEMBER_EXAM_TENANT_ID,auth=req.headers.get('authorization');
 if(!key||Buffer.byteLength(key)<32||!tenant||!auth?.startsWith('Bearer ')||!timingSafeEqual(digest(key),digest(auth.slice(7))))return reply({ok:false,code:'UNAUTHORIZED'},401);
 try{const r=await (await getPool()).request().input('tenant',sql.UniqueIdentifier,tenant).query(`
 SELECT TOP(1000) e.EducationType AS type,e.Institution AS institution,e.FacultyOrSpecialization AS faculty
 FROM dbo.CutEducationCatalog e JOIN dbo.Tenant t ON t.TenantId=e.TenantId AND t.Status=N'active'
 WHERE e.TenantId=@tenant AND e.IsActive=1 ORDER BY e.EducationType,e.Institution,e.FacultyOrSpecialization
 `);return reply({ok:true,items:r.recordset});}catch{return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);}
}

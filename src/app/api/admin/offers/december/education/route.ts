import {NextRequest,NextResponse} from 'next/server';
import {requireAdmin,isAuthResult} from '@/lib/api-auth';
import {getPool,sql} from '@/lib/db';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private,no-store','X-Robots-Tag':'noindex'}});
const enabled=(id:string)=>process.env.DECEMBER_EXAM_STAFF_ENABLED==='true'&&id.toLowerCase()===process.env.DECEMBER_EXAM_TENANT_ID?.toLowerCase();
const tidy=(v:unknown)=>typeof v==='string'?v.trim().replace(/\s+/g,' '):'';
export async function GET(){
 const auth=await requireAdmin();if(!isAuthResult(auth))return auth;if(!enabled(auth.tenantId))return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);
 try{const r=await (await getPool()).request().input('tenant',sql.UniqueIdentifier,auth.tenantId).query(`
 SELECT TOP(1000) EntryId,EducationType,Institution,FacultyOrSpecialization,IsActive FROM dbo.CutEducationCatalog
 WHERE TenantId=@tenant ORDER BY EducationType,Institution,FacultyOrSpecialization
 `);return reply({ok:true,items:r.recordset});}catch{return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);}
}
export async function POST(req:NextRequest){
 const origin=process.env.DECEMBER_EXAM_CASHER_PUBLIC_ORIGIN||(process.env.NODE_ENV==='production'?'https://ops.cutsaloon.com':req.nextUrl.origin);
 if(req.headers.get('origin')!==origin||!req.headers.get('content-type')?.startsWith('application/json'))return reply({ok:false,code:'ORIGIN_REQUIRED'},403);
 const auth=await requireAdmin();if(!isAuthResult(auth))return auth;if(!enabled(auth.tenantId))return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);
 const b=await req.json().catch(()=>null);if(!b)return reply({ok:false,code:'INVALID_REQUEST'},400);
 try{
 const rq=(await getPool()).request().input('tenant',sql.UniqueIdentifier,auth.tenantId);
 if(b.action==='SET_ACTIVE'){
  if(typeof b.entryId!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(b.entryId)||typeof b.active!=='boolean')return reply({ok:false,code:'INVALID_REQUEST'},400);
  const r=await rq.input('entry',sql.UniqueIdentifier,b.entryId).input('active',sql.Bit,b.active).query('UPDATE dbo.CutEducationCatalog SET IsActive=@active WHERE TenantId=@tenant AND EntryId=@entry');
  return r.rowsAffected[0]===1?reply({ok:true}):reply({ok:false,code:'NOT_FOUND'},404);
 }
 const type=b.type,institution=tidy(b.institution),faculty=tidy(b.faculty);
 if(b.action!=='CREATE'||!['UNIVERSITY','SCHOOL','INSTITUTE'].includes(type)||!institution||institution.length>120||faculty.length>120||(type==='SCHOOL'?!!faculty:!faculty))return reply({ok:false,code:'INVALID_REQUEST'},400);
 await rq.input('type',sql.VarChar(12),type).input('institution',sql.NVarChar(120),institution).input('faculty',sql.NVarChar(120),faculty).input('user',sql.Int,auth.userId).query(`
 INSERT dbo.CutEducationCatalog(TenantId,EducationType,Institution,FacultyOrSpecialization,CreatedBy)
 VALUES(@tenant,@type,@institution,@faculty,@user)
 `);
 return reply({ok:true},201);
 }catch(e){const n=(e as {number?:number})?.number;return n===2601||n===2627?reply({ok:false,code:'ALREADY_EXISTS'},409):reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);}
}

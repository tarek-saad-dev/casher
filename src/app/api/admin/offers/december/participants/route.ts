import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin,isAuthResult } from '@/lib/api-auth';
import { getPool,sql } from '@/lib/db';
import { normalizeEgyptianMobile } from '@/lib/campaigns/december-exam/registration';
import { DECEMBER_CAMPAIGN_CODE } from '@/lib/campaigns/december-exam/registrationRepository';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private,no-store','X-Robots-Tag':'noindex'}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const enabled=(tenant:string)=>process.env.DECEMBER_EXAM_STAFF_ENABLED==='true' && tenant.toLowerCase()===process.env.DECEMBER_EXAM_TENANT_ID?.toLowerCase();

export async function GET(req:NextRequest){
  const staff=await requireAdmin();
  if(!isAuthResult(staff))return staff;
  if(!enabled(staff.tenantId))return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);
  const code=req.nextUrl.searchParams.get('code')?.trim().toUpperCase()||null;
  const rawPhone=req.nextUrl.searchParams.get('phone');
  let phone:string|null=null;
  try{if(rawPhone)phone=normalizeEgyptianMobile(rawPhone);}catch{return reply({ok:false,code:'INVALID_REQUEST'},400);}
  if((code&&!/^CUT-[A-F0-9]{16}$/.test(code))||(code&&phone))return reply({ok:false,code:'INVALID_REQUEST'},400);
  try{
    const r=await (await getPool()).request().input('tenant',sql.UniqueIdentifier,staff.tenantId)
      .input('campaign',sql.VarChar(48),DECEMBER_CAMPAIGN_CODE).input('code',sql.VarChar(32),code).input('phone',sql.VarChar(16),phone)
      .query(`
        SELECT TOP(100) p.ParticipantId,p.DisplayName,LEFT(p.PhoneNormalized,4)+'****'+RIGHT(p.PhoneNormalized,3) AS PhoneMasked,
          p.ReferralCode,p.ClientId,p.IsStudent,p.EducationType,p.Institution,p.FacultyOrSpecialization,p.AcademicYear,
          p.IdentityVerifiedAtUtc,p.StudentVerifiedAtUtc,p.CreatedAtUtc
        FROM dbo.CutOfferParticipant p
        JOIN dbo.CutOfferCampaign c ON c.TenantId=p.TenantId AND c.CampaignId=p.CampaignId
        WHERE p.TenantId=@tenant AND c.Code=@campaign
          AND ((@code IS NULL AND @phone IS NULL AND p.IdentityVerifiedAtUtc IS NULL) OR p.ReferralCode=@code OR p.PhoneNormalized=@phone)
        ORDER BY p.CreatedAtUtc DESC,p.ParticipantId
      `);
    return reply({ok:true,items:r.recordset});
  }catch{return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);}
}
type Participant={ClientId:number|null;PhoneNormalized:string;IsStudent:boolean;EducationType:string|null;Institution:string|null;FacultyOrSpecialization:string|null};
export async function POST(req:NextRequest){
  const origin=process.env.DECEMBER_EXAM_CASHER_PUBLIC_ORIGIN || (process.env.NODE_ENV==='production'?'https://ops.cutsaloon.com':req.nextUrl.origin);
  if(req.headers.get('origin')!==origin||!req.headers.get('content-type')?.startsWith('application/json'))
    return reply({ok:false,code:'ORIGIN_REQUIRED'},403);
  const staff=await requireAdmin();
  if(!isAuthResult(staff))return staff;
  if(!enabled(staff.tenantId))return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);
  const body=await req.json().catch(()=>null);
  if(!body||typeof body.participantId!=='string'||!uuid.test(body.participantId)||!Number.isSafeInteger(body.clientId)
    ||body.clientId<=0||body.clientId>2147483647||body.confirmedInPerson!==true||typeof body.studentCardChecked!=='boolean')
    return reply({ok:false,code:'INVALID_REQUEST'},400);
  try{
    const tx=new sql.Transaction(await getPool());
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try{
      const rq=()=>new sql.Request(tx).input('tenant',sql.UniqueIdentifier,staff.tenantId)
        .input('campaign',sql.VarChar(48),DECEMBER_CAMPAIGN_CODE).input('participant',sql.UniqueIdentifier,body.participantId);
      const row=await rq().query<Participant>(`
        SELECT p.ClientId,p.PhoneNormalized,p.IsStudent,p.EducationType,p.Institution,p.FacultyOrSpecialization
        FROM dbo.CutOfferParticipant p WITH(UPDLOCK,HOLDLOCK)
        JOIN dbo.CutOfferCampaign c WITH(HOLDLOCK) ON c.TenantId=p.TenantId AND c.CampaignId=p.CampaignId
        WHERE p.TenantId=@tenant AND c.Code=@campaign AND c.Status='ACTIVE'
          AND c.StartsAtUtc<=SYSUTCDATETIME() AND c.EndsAtUtc>SYSUTCDATETIME() AND p.ParticipantId=@participant
      `);
      const p=row.recordset[0];
      if(!p|| (p.ClientId!==null&&p.ClientId!==body.clientId)){await tx.rollback();return reply({ok:false,code:'REVIEW_CONFLICT'},409);}
      if(body.studentCardChecked&&(!p.IsStudent||!p.Institution||!p.EducationType||
        (p.EducationType!=='SCHOOL'&&!p.FacultyOrSpecialization))){await tx.rollback();return reply({ok:false,code:'STUDENT_DATA_REQUIRED'},409);}
      const customer=await new sql.Request(tx).input('tenant',sql.UniqueIdentifier,staff.tenantId)
        .input('client',sql.Int,body.clientId).query<{Mobile:string|null}>(`
          SELECT Mobile FROM dbo.TblClient WITH(UPDLOCK,HOLDLOCK) WHERE TenantId=@tenant AND ClientID=@client
        `);
      let mobile:string|null=null;
      try{mobile=normalizeEgyptianMobile(customer.recordset[0]?.Mobile);}catch{/* no match */}
      if(customer.recordset.length!==1||mobile!==p.PhoneNormalized){await tx.rollback();return reply({ok:false,code:'IDENTITY_MISMATCH'},409);}
      const taken=await rq().input('client',sql.Int,body.clientId).query(`
        SELECT TOP(1) p.ParticipantId FROM dbo.CutOfferParticipant p WITH(UPDLOCK,HOLDLOCK)
        JOIN dbo.CutOfferCampaign c ON c.TenantId=p.TenantId AND c.CampaignId=p.CampaignId
        WHERE p.TenantId=@tenant AND c.Code=@campaign AND p.ClientId=@client AND p.ParticipantId<>@participant
      `);
      if(taken.recordset.length){await tx.rollback();return reply({ok:false,code:'CLIENT_ALREADY_LINKED'},409);}
      // Only a staff-reviewed card can update canonical education. Never change name,
      // mobile, occupation, wallet or marketing permissions from an anonymous form.
      if(body.studentCardChecked){
        const profile=await new sql.Request(tx).input('tenant',sql.UniqueIdentifier,staff.tenantId)
          .input('client',sql.Int,body.clientId).input('institution',sql.NVarChar(150),p.Institution)
          .input('faculty',sql.NVarChar(120),p.FacultyOrSpecialization)
          .input('level',sql.NVarChar(16),p.EducationType==='SCHOOL'?'school':'college')
          .query(`UPDATE dbo.TblClient SET CustomerCategory=N'student',EducationLevel=@level,
            InstitutionName=@institution,FacultyName=@faculty WHERE TenantId=@tenant AND ClientID=@client`);
        if(profile.rowsAffected[0]!==1)throw Error('PROFILE_CONFLICT');
      }
      const updated=await rq().input('client',sql.Int,body.clientId).input('staff',sql.Int,staff.userId)
        .input('student',sql.Bit,body.studentCardChecked).query(`
        UPDATE p SET ClientId=@client,
          IdentityVerifiedAtUtc=COALESCE(IdentityVerifiedAtUtc,SYSUTCDATETIME()),
          IdentityVerifiedBy=COALESCE(IdentityVerifiedBy,@staff),
          StudentVerifiedAtUtc=CASE WHEN @student=1 THEN SYSUTCDATETIME() ELSE StudentVerifiedAtUtc END,
          StudentVerifiedBy=CASE WHEN @student=1 THEN @staff ELSE StudentVerifiedBy END
        FROM dbo.CutOfferParticipant p JOIN dbo.CutOfferCampaign c ON c.TenantId=p.TenantId AND c.CampaignId=p.CampaignId
        WHERE p.TenantId=@tenant AND c.Code=@campaign AND p.ParticipantId=@participant
      `);
      if(updated.rowsAffected[0]!==1)throw Error('REVIEW_CONFLICT');
      await tx.commit();
      return reply({ok:true,identityVerified:true,studentCardChecked:body.studentCardChecked});
    }catch(e){await tx.rollback().catch(()=>null);throw e;}
  }catch{return reply({ok:false,code:'CAMPAIGN_UNAVAILABLE'},503);}
}

import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { getPool, sql } from '@/lib/db';
import { parseRegistration } from './registration';

export class DecemberRegistrationError extends Error {
  constructor(public readonly code:string, public readonly status:number){super(code);}
}
export const DECEMBER_CAMPAIGN_CODE='DECEMBER_EXAM_2026';
export function campaignSessionDigest(token:string){
  return createHash('sha256').update('cut-offer-session-v1:').update(token).digest('hex');
}
/** Internal persistence boundary. No anonymous caller can link a canonical customer,
 * mark a student verified, or retrieve an existing registration by phone.
 * The HTTP adapter MUST enforce origin, shared key, rate limiting and request size. */
export async function registerDecemberParticipant(tenantId:string, input:unknown) {
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(tenantId))
    throw new DecemberRegistrationError('CAMPAIGN_UNAVAILABLE',503);
  let registration:ReturnType<typeof parseRegistration>;
  try{registration=parseRegistration(input);}
  catch{throw new DecemberRegistrationError('INVALID_REGISTRATION',400);}
  const pool=await getPool();
  const tx=new sql.Transaction(pool);
  const participantId=randomUUID(), token=randomBytes(32).toString('base64url');
  const referralCode='CUT-'+randomBytes(8).toString('hex').toUpperCase();
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try{
    const campaign=await new sql.Request(tx).input('tenant',sql.UniqueIdentifier,tenantId)
      .input('code',sql.VarChar(48),DECEMBER_CAMPAIGN_CODE)
      .query<{CampaignId:string}>(`
        SELECT c.CampaignId FROM dbo.CutOfferCampaign c WITH (HOLDLOCK)
        INNER JOIN dbo.Tenant t ON t.TenantId=c.TenantId
        WHERE c.TenantId=@tenant AND c.Code=@code AND c.Status='ACTIVE'
          AND t.Status=N'active' AND c.StartsAtUtc<=SYSUTCDATETIME() AND c.EndsAtUtc>SYSUTCDATETIME()
      `);
    const campaignId=campaign.recordset[0]?.CampaignId;
    if(!campaignId)throw new DecemberRegistrationError('CAMPAIGN_UNAVAILABLE',503);
    const request=()=>new sql.Request(tx).input('tenant',sql.UniqueIdentifier,tenantId).input('campaign',sql.UniqueIdentifier,campaignId);
    // Serialize campaign registrations across app instances and bound successful writes.
    // This is a circuit breaker, not a replacement for trusted ingress anti-bot/IP limits.
    const quota=Number(process.env.DECEMBER_EXAM_REGISTRATION_MAX_PER_MINUTE||'60');
    if(!Number.isSafeInteger(quota)||quota<1||quota>300)throw new DecemberRegistrationError('CAMPAIGN_UNAVAILABLE',503);
    const lock=await request().query<{result:number}>(`
      DECLARE @resource NVARCHAR(255)=N'cut-offer-register:'+CONVERT(NVARCHAR(36),@tenant)+N':'+CONVERT(NVARCHAR(36),@campaign);
      DECLARE @result INT;
      EXEC @result=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=3000;
      SELECT @result result;
    `);
    if((lock.recordset[0]?.result??-1)<0)throw new DecemberRegistrationError('REGISTRATION_BUSY',429);
    const recent=await request().query<{n:number}>(`
      SELECT COUNT(*) n FROM dbo.CutOfferParticipant
      WHERE TenantId=@tenant AND CampaignId=@campaign AND CreatedAtUtc>DATEADD(minute,-1,SYSUTCDATETIME())
    `);
    if(Number(recent.recordset[0]?.n??quota)>=quota)throw new DecemberRegistrationError('REGISTRATION_BUSY',429);
    const existing=await request().input('phone',sql.VarChar(16),registration.phone).query(`
      SELECT TOP (1) ParticipantId FROM dbo.CutOfferParticipant WITH (UPDLOCK,HOLDLOCK)
      WHERE TenantId=@tenant AND CampaignId=@campaign AND PhoneNormalized=@phone
    `);
    // No existing code, name or session disclosed. Staff-assisted recovery is required.
    if(existing.recordset.length)throw new DecemberRegistrationError('REGISTRATION_REVIEW_REQUIRED',409);
    let inviterId:string|undefined;
    if(registration.referralCode){
      const inviter=await request().input('referral',sql.VarChar(32),registration.referralCode)
        .input('phone',sql.VarChar(16),registration.phone).query<{ParticipantId:string}>(`
          SELECT p.ParticipantId FROM dbo.CutOfferParticipant p WITH (UPDLOCK,HOLDLOCK)
          WHERE p.TenantId=@tenant AND p.CampaignId=@campaign AND p.ReferralCode=@referral AND p.PhoneNormalized<>@phone
          AND NOT EXISTS(SELECT 1 FROM dbo.CutOfferRedemption d WITH(UPDLOCK,HOLDLOCK)
            WHERE d.TenantId=p.TenantId AND d.CampaignId=p.CampaignId AND d.ParticipantId=p.ParticipantId)
        `);
      inviterId=inviter.recordset[0]?.ParticipantId;
      if(!inviterId)throw new DecemberRegistrationError('INVALID_REFERRAL_CODE',400);
    }
    const education=registration.education;
    const institution=education?.type==='UNIVERSITY'?education.university:education?.type==='SCHOOL'?education.school:education?.institute;
    const faculty=education?.type==='UNIVERSITY'?education.faculty:education?.type==='INSTITUTE'?education.specialization:null;
    const year=education?.type==='SCHOOL'?education.stage:education?.year;
    await request().input('participant',sql.UniqueIdentifier,participantId)
      .input('phone',sql.VarChar(16),registration.phone).input('name',sql.NVarChar(100),registration.name)
      .input('student',sql.Bit,registration.student).input('type',sql.VarChar(12),education?.type??null)
      .input('institution',sql.NVarChar(120),institution??null).input('faculty',sql.NVarChar(120),faculty??null)
      .input('year',sql.NVarChar(60),year??null).input('consent',sql.Bit,registration.marketingConsent)
      .input('referral',sql.VarChar(32),referralCode).input('digest',sql.Char(64),campaignSessionDigest(token))
      .query(`
        INSERT dbo.CutOfferParticipant(TenantId,CampaignId,ParticipantId,PhoneNormalized,DisplayName,
          IsStudent,EducationType,Institution,FacultyOrSpecialization,AcademicYear,MarketingConsentRequested,ReferralCode,SessionDigest)
        VALUES(@tenant,@campaign,@participant,@phone,@name,@student,@type,@institution,@faculty,@year,@consent,@referral,@digest)
      `);
    if(inviterId)await request().input('participant',sql.UniqueIdentifier,participantId)
      .input('inviter',sql.UniqueIdentifier,inviterId).query(`
        INSERT dbo.CutOfferReferral(TenantId,CampaignId,InviteeId,InviterId)
        VALUES(@tenant,@campaign,@participant,@inviter)
      `);
    await tx.commit();
    return {ok:true as const,sessionToken:token,referralCode,identityStatus:'PENDING' as const,
      referralStatus:inviterId?'PENDING' as const:null};
  }catch(error){
    await tx.rollback().catch(()=>null);
    throw error;
  }
}

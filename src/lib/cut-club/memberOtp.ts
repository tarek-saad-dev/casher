import 'server-only';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { getPool, sql } from '@/lib/db';
import { sendDrvowaCutClubOtp, verifyDrvowaCutClubOtp, type CutClubOtpPurpose } from '@/lib/integrations/drvowaClient';

/** The POS staff session is NEVER accepted as a customer identity. */
export const CLUB_SESSION_SECONDS = 2 * 60 * 60;
const tenantUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const tokenRe = /^[a-zA-Z0-9_-]{43}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export class ClubAuthError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
  }
}
export function cutClubTenant(env: NodeJS.ProcessEnv = process.env): string {
  const id = env.CUT_CLUB_AUTH_TENANT_ID;
  if (!id || !tenantUuid.test(id) || env.CUT_CLUB_MEMBER_WALLET_ENABLED !== 'true')
    throw new ClubAuthError('CUT_CLUB_NOT_ENABLED', 503);
  return id.toLowerCase();
}
export function secureBffKey(received: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  const configured = env.CUT_CLUB_BFF_SHARED_KEY;
  if (env.CUT_CLUB_MEMBER_WALLET_ENABLED !== 'true' ||
      !configured || Buffer.byteLength(configured, 'utf8') < 32 ||
      !received?.startsWith('Bearer ')) return false;
  const supplied = received.slice(7);
  const a = createHash('sha256').update(configured).digest();
  const c = createHash('sha256').update(supplied).digest();
  return timingSafeEqual(a, c);
}
export function normalizeCutClubPhone(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 32) return null;
  const clean = input.replace(/[\s+\-().]/g, '');
  const phone = /^01[0125]\d{8}$/.test(clean) ? '2' + clean : clean.startsWith('0020') ? clean.slice(2) : clean;
  return /^201[0125]\d{8}$/.test(phone) ? phone : null;
}
export function digestToken(token: string): string {
  return createHash('sha256').update('cutclub-member-session-v1:').update(token).digest('hex');
}
export function newOpaque(): string { return randomBytes(32).toString('base64url'); }
export function validPurpose(p: unknown): p is CutClubOtpPurpose { return p === 'CUT_CLUB_SIGNUP' || p === 'LOGIN'; }
function goodToken(t: unknown): t is string { return typeof t === 'string' && tokenRe.test(t); }
function request(txOrPool: any) { return txOrPool.request ? txOrPool.request() : new sql.Request(txOrPool); }

export async function startCutClubOtp(raw: unknown, purpose: unknown) {
  const tenantId = cutClubTenant();
  const phone = normalizeCutClubPhone(raw);
  if (!phone || !validPurpose(purpose)) throw new ClubAuthError('INVALID_REQUEST', 400);
  // DRVO is authoritative for 60s cooldown, per-phone/hour/day and business quota.
  // It issues and stores the OTP; we only persist a browser-bound pending capability.
  const sent = await sendDrvowaCutClubOtp({ phone, purpose, requestId: randomUUID() });
  if (!uuid.test(sent.challengeId) || !['SENT', 'UNKNOWN', 'SENDING'].includes(sent.status) ||
      !Number.isFinite(Date.parse(sent.expiresAtUtc)) ||
      Date.parse(sent.expiresAtUtc) > Date.now() + 300_000 ||
      Date.parse(sent.expiresAtUtc) <= Date.now())
    throw new ClubAuthError('OTP_PROVIDER_INVALID_RESPONSE', 503);
  const pendingToken = newOpaque();
  const db = await getPool();
  await db.request()
    .input('digest', sql.Char(64), digestToken(pendingToken))
    .input('tenant', sql.UniqueIdentifier, tenantId)
    .input('phone', sql.NVarChar(20), phone)
    .input('purpose', sql.VarChar(24), purpose)
    .input('requestId', sql.UniqueIdentifier, randomUUID())
    .input('challenge', sql.UniqueIdentifier, sent.challengeId)
    .input('expires', sql.DateTime2, new Date(sent.expiresAtUtc))
    .query(`INSERT dbo.CutClubOtpPending
      (TokenDigest,TenantId,PhoneNormalized,Purpose,RequestID,ChallengeID,Status,ExpiresAtUtc)
      VALUES (@digest,@tenant,@phone,@purpose,@requestId,@challenge,'READY',@expires)`);
  return { pendingToken, resendAfterSec: sent.resendAfterSec, expiresAtUtc: sent.expiresAtUtc };
}

export type VerifiedMemberIdentity = {
  accountId: string; tenantId: string; legacyClientId: number | null;
  linkStatus: 'ACTIVE' | 'UNLINKED' | 'REVIEW_REQUIRED';
};

/** Only verified + consumed DRVO challenge may enter here. */
async function bindVerifiedPhone(tenantId: string, phone: string): Promise<VerifiedMemberIdentity> {
  const db = await getPool();
  const tx = new sql.Transaction(db);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    // Name, account and duplicate legacy matches are never disclosed before OTP.
    // A verified WhatsApp SIM alone DOES NOT authorize historical Casher balances.
    const rawMatches = await new sql.Request(tx)
      .input('tenant', sql.UniqueIdentifier, tenantId)
      .input('phone', sql.NVarChar(20), phone)
      .query<{ ClientID: number }>(`
        SELECT TOP (2) c.ClientID
        FROM dbo.TblClient AS c WITH (HOLDLOCK)
        CROSS APPLY (SELECT REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
          LTRIM(RTRIM(c.Mobile)), ' ', ''), '-', ''), '+', ''), '(', ''), ')', '')
          AS MobileClean) cleaned
        CROSS APPLY (SELECT CASE
          WHEN LEN(cleaned.MobileClean)=11 AND cleaned.MobileClean LIKE '01[0125]%'
            THEN '2' + cleaned.MobileClean
          WHEN LEN(cleaned.MobileClean)=14 AND cleaned.MobileClean LIKE '00201[0125]%'
            THEN SUBSTRING(cleaned.MobileClean, 3, 12)
          ELSE cleaned.MobileClean END AS Phone
        ) normalized
        WHERE c.TenantId=@tenant AND normalized.Phone=@phone
        ORDER BY c.ClientID
      `);
    const rows = rawMatches.recordset;
    const knownAccount = await new sql.Request(tx)
      .input('tenant', sql.UniqueIdentifier, tenantId)
      .input('phone', sql.NVarChar(20), phone)
      .query<{ AccountID: string; LegacyClientID: number | null; LinkStatus: VerifiedMemberIdentity['linkStatus'] }>(`
        SELECT AccountID,LegacyClientID,LinkStatus
        FROM dbo.CutClubMemberAccount WITH (UPDLOCK,HOLDLOCK)
        WHERE TenantId=@tenant AND PhoneNormalized=@phone
      `);
    if (knownAccount.recordset.length > 1) throw new ClubAuthError('ACCOUNT_REVIEW_REQUIRED',409);
    const current = knownAccount.recordset[0];
    if (current?.LinkStatus === 'ACTIVE') {
      if (rows.length !== 1 || rows[0].ClientID !== current.LegacyClientID) {
        // If phone record changes or duplicates arise, fail closed: no wallet.
        throw new ClubAuthError('ACCOUNT_REVIEW_REQUIRED',409);
      }
      await tx.commit();
      return { accountId: current.AccountID, tenantId, legacyClientId: current.LegacyClientID, linkStatus: 'ACTIVE' };
    }
    const desired = rows.length > 0 ? 'REVIEW_REQUIRED' : 'UNLINKED';
    const result = current
      ? await new sql.Request(tx)
        .input('tenant',sql.UniqueIdentifier,tenantId).input('phone',sql.NVarChar(20),phone)
        .input('desired',sql.VarChar(24),desired).query<{ AccountID:string }>(`
          UPDATE dbo.CutClubMemberAccount
          SET LinkStatus=@desired, UpdatedAtUtc=SYSUTCDATETIME()
          OUTPUT INSERTED.AccountID
          WHERE TenantId=@tenant AND PhoneNormalized=@phone AND LinkStatus<>'ACTIVE'
        `)
      : await new sql.Request(tx)
        .input('tenant',sql.UniqueIdentifier,tenantId).input('phone',sql.NVarChar(20),phone)
        .input('desired',sql.VarChar(24),desired).query<{ AccountID:string }>(`
          INSERT dbo.CutClubMemberAccount(TenantId,PhoneNormalized,LinkStatus)
          OUTPUT INSERTED.AccountID VALUES(@tenant,@phone,@desired)
        `);
    if (result.recordset.length !== 1) throw new ClubAuthError('ACCOUNT_REVIEW_REQUIRED',409);
    await tx.commit();
    return { accountId: result.recordset[0].AccountID, tenantId, legacyClientId: null, linkStatus: desired };
  } catch (error) {
    await tx.rollback().catch(() => null);
    throw error;
  }
}

export async function verifyCutClubOtp(pendingToken: unknown, code: unknown) {
  const tenantId = cutClubTenant();
  if (!goodToken(pendingToken) || typeof code !== 'string' || !/^\d{6}$/.test(code))
    throw new ClubAuthError('INVALID_OTP',400);
  const db = await getPool();
  const digest = digestToken(pendingToken);
  const lease = randomUUID();
  // An atomic lease prevents parallel DRVO verifies for one pending cookie.
  const claimed = await db.request()
    .input('digest',sql.Char(64),digest).input('tenant',sql.UniqueIdentifier,tenantId)
    .input('lease',sql.UniqueIdentifier,lease)
    .query<{ PhoneNormalized:string; Purpose:CutClubOtpPurpose; ChallengeID:string }>(`
      UPDATE dbo.CutClubOtpPending
      SET Status='VERIFYING',VerifyLease=@lease
      OUTPUT INSERTED.PhoneNormalized,INSERTED.Purpose,INSERTED.ChallengeID
      WHERE TokenDigest=@digest AND TenantId=@tenant AND Status='READY'
        AND ExpiresAtUtc>SYSUTCDATETIME() AND ConsumedAtUtc IS NULL
    `);
  const pending=claimed.recordset[0];
  if (!pending) throw new ClubAuthError('OTP_EXPIRED_OR_USED',410);
  let verified;
  try {
    verified = await verifyDrvowaCutClubOtp({
      challengeId:pending.ChallengeID,phone:pending.PhoneNormalized,
      purpose:pending.Purpose,code,
    });
  } catch (error) {
    await db.request().input('digest',sql.Char(64),digest)
      .input('lease',sql.UniqueIdentifier,lease).query(`
        UPDATE dbo.CutClubOtpPending SET Status='READY',VerifyLease=NULL
        WHERE TokenDigest=@digest AND VerifyLease=@lease AND Status='VERIFYING'
          AND ExpiresAtUtc>SYSUTCDATETIME()`);
    throw error;
  }
  if (verified?.verified !== true || verified.phoneNormalized !== pending.PhoneNormalized ||
      verified.purpose !== pending.Purpose) {
    throw new ClubAuthError('OTP_PROVIDER_INVALID_RESPONSE',503);
  }
  // DRVO OTP has already been consumed exactly once: local retry cannot reuse it.
  const consumed = await db.request().input('digest',sql.Char(64),digest)
    .input('lease',sql.UniqueIdentifier,lease).query(`
      UPDATE dbo.CutClubOtpPending
      SET Status='CONSUMED', ConsumedAtUtc=SYSUTCDATETIME(),VerifyLease=NULL
      WHERE TokenDigest=@digest AND VerifyLease=@lease AND Status='VERIFYING'
        AND ExpiresAtUtc>SYSUTCDATETIME()`);
  if (consumed.rowsAffected[0] !== 1) throw new ClubAuthError('OTP_EXPIRED_OR_USED',410);
  const identity=await bindVerifiedPhone(tenantId,pending.PhoneNormalized);
  const sessionToken=newOpaque();
  await db.request().input('digest',sql.Char(64),digestToken(sessionToken))
    .input('tenant',sql.UniqueIdentifier,tenantId)
    .input('account',sql.UniqueIdentifier,identity.accountId)
    .query(`INSERT dbo.CutClubCustomerSession(TokenDigest,TenantId,AccountID,ExpiresAtUtc)
      VALUES(@digest,@tenant,@account,DATEADD(SECOND,7200,SYSUTCDATETIME()))`);
  return { sessionToken, status: identity.linkStatus, expiresInSec: CLUB_SESSION_SECONDS };
}

export async function getCutClubSession(token: unknown): Promise<VerifiedMemberIdentity | null> {
  if (!goodToken(token)) return null;
  const tenantId = cutClubTenant();
  const db=await getPool();
  const result=await db.request().input('digest',sql.Char(64),digestToken(token))
    .input('tenant',sql.UniqueIdentifier,tenantId)
    .query<{AccountID:string;TenantId:string;LegacyClientID:number|null;LinkStatus:VerifiedMemberIdentity['linkStatus']}>(`
      SELECT a.AccountID,a.TenantId,a.LegacyClientID,a.LinkStatus
      FROM dbo.CutClubCustomerSession s
      JOIN dbo.CutClubMemberAccount a ON a.AccountID=s.AccountID AND a.TenantId=s.TenantId
      WHERE s.TokenDigest=@digest AND s.TenantId=@tenant
        AND s.RevokedAtUtc IS NULL AND s.ExpiresAtUtc>SYSUTCDATETIME()
    `);
  const a=result.recordset[0];
  return a?{accountId:a.AccountID,tenantId:a.TenantId,legacyClientId:a.LinkStatus==='ACTIVE'?a.LegacyClientID:null,linkStatus:a.LinkStatus}:null;
}
export async function logoutCutClubSession(token: unknown): Promise<void> {
  if(!goodToken(token))return;
  const tenantId=cutClubTenant();
  await (await getPool()).request().input('digest',sql.Char(64),digestToken(token))
    .input('tenant',sql.UniqueIdentifier,tenantId).query(`
      UPDATE dbo.CutClubCustomerSession SET RevokedAtUtc=SYSUTCDATETIME()
      WHERE TokenDigest=@digest AND TenantId=@tenant AND RevokedAtUtc IS NULL
    `);
}

import { beforeAll,afterAll,beforeEach,describe,it,expect,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import mssql from 'mssql';

// This suite NEVER runs during ordinary tests, only on disposable localhost
// GitHub Actions MSSQL. All business data are synthetic fixtures.
const enabled=process.env.CUT_CLUB_EPHEMERAL_SQL==='1' &&
  process.env.CUT_CLUB_EPHEMERAL_HOST==='127.0.0.1' &&
  process.env.CI==='true';
const provider=vi.hoisted(()=>({send:vi.fn(),verify:vi.fn()}));
vi.mock('@/lib/integrations/drvowaClient',()=>({
  sendDrvowaCutClubOtp:provider.send,verifyDrvowaCutClubOtp:provider.verify,
}));
let pool:mssql.ConnectionPool|null=null;
vi.mock('@/lib/db',async()=>({
  sql:(await import('mssql')).default,
  getPool:async()=>{
    if(!pool)throw Error('CUT_CLUB_TEST_SQL_POOL_NOT_READY');
    return pool;
  },
}));
import { startCutClubOtp,verifyCutClubOtp,getCutClubSession,logoutCutClubSession,digestToken } from '../cut-club/memberOtp';
import { loadCutClubWallet } from '../cut-club/memberWalletRead';
import { verifyCutClubMemberWalletSchema } from '../../../scripts/drvo/migrations/026-cut-club-member-wallet';

const tenant='413d433e-f36b-1410-8820-009ec495c7e1';
const phone='201557994946';
const inactiveClient='01100000000';

describe.skipIf(!enabled)('CUT CLUB REAL disposable SQL acceptance (NO staging / NO production)',()=>{
  beforeAll(async()=>{
    const pass=process.env.CUT_CLUB_EPHEMERAL_AGENT_PASSWORD;
    if(!pass)throw Error('MISSING_ISOLATED_PASSWORD');
    pool=await new mssql.ConnectionPool({
      server:'127.0.0.1',port:1433,database:'last132_agent',
      user:'drvo_agent',password:pass,
      options:{encrypt:false,trustServerCertificate:true},
      pool:{max:12,min:0,idleTimeoutMillis:5000},
    }).connect();
    process.env.CUT_CLUB_MEMBER_WALLET_ENABLED='true';
    process.env.CUT_CLUB_AUTH_TENANT_ID=tenant;
    process.env.CUT_CLUB_AUTH_TENANT_CODE='CUT_SALON_TEST';
  });
  afterAll(async()=>{await pool?.close();pool=null;});
  beforeEach(async()=>{
    await pool!.request().query(`
      DELETE FROM dbo.CutClubCustomerSession;
      DELETE FROM dbo.CutClubOtpPending;
      DELETE FROM dbo.CutClubMemberAccount;
    `);
    provider.send.mockReset();provider.verify.mockReset();
    provider.send.mockImplementation(async()=>({
      challengeId:randomUUID(),status:'SENT',
      expiresAtUtc:new Date(Date.now()+240000).toISOString(),
      resendAfterSec:60,idempotentReplay:false,
    }));
    provider.verify.mockImplementation(async (params:{phone:string;purpose:string})=>({
      verified:true,phoneNormalized:params.phone,purpose:params.purpose,
    }));
  });
  it('production manifest verifies real tables, trusted constraints and unique indexes',async()=>{
    const result=await verifyCutClubMemberWalletSchema(pool!);
    expect(result).toEqual({ok:true,failures:[]});
  });
  it('signup creates an anonymous-linked customer account after verified WhatsApp phone',async()=>{
    const issued=await startCutClubOtp(inactiveClient,'CUT_CLUB_SIGNUP');
    expect(issued.pendingToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const auth=await verifyCutClubOtp(issued.pendingToken,'123456');
    expect(auth.status).toBe('UNLINKED');
    expect((await loadCutClubWallet(auth.sessionToken))?.coins).toBeNull();
    const state=await pool!.request().input('digest',mssql.Char(64),digestToken(issued.pendingToken))
      .query<{Status:string}>(`SELECT Status FROM dbo.CutClubOtpPending WHERE TokenDigest=@digest`);
    expect(state.recordset[0]?.Status).toBe('CONSUMED');
    await expect(verifyCutClubOtp(issued.pendingToken,'123456')).rejects.toThrow('OTP_EXPIRED_OR_USED');
  });
  it('two historical customers sharing a phone are reviewed, not auto-claimed',async()=>{
    const issued=await startCutClubOtp('01557994946','LOGIN');
    const auth=await verifyCutClubOtp(issued.pendingToken,'123456');
    expect(auth.status).toBe('REVIEW_REQUIRED');
    const pending=await loadCutClubWallet(auth.sessionToken);
    expect(pending?.ownedVouchers).toBeNull();
    expect(pending?.movements).toBeNull();
    const rows=await pool!.request().query<{LinkStatus:string;LegacyClientID:number|null}>(`
      SELECT LinkStatus,LegacyClientID FROM dbo.CutClubMemberAccount`);
    expect(rows.recordset).toHaveLength(1);
    expect(rows.recordset[0]).toMatchObject({LinkStatus:'REVIEW_REQUIRED',LegacyClientID:null});
  });
  it('after separately approved legacy binding reads ONLY this customer’s actual Coins, vouchers and ledger',async()=>{
    const issued=await startCutClubOtp('01557994946','LOGIN');
    const auth=await verifyCutClubOtp(issued.pendingToken,'123456');
    await pool!.request().input('tenant',mssql.UniqueIdentifier,tenant)
      .input('phone',mssql.NVarChar(20),phone)
      .query(`
        UPDATE dbo.CutClubMemberAccount
        SET LinkStatus='ACTIVE',LegacyClientID=7,LinkApprovedBy=1,
            LinkProofType='IN_PERSON_ID',LinkApprovedAtUtc=SYSUTCDATETIME()
        WHERE TenantId=@tenant AND PhoneNormalized=@phone
      `);
    const wallet=await loadCutClubWallet(auth.sessionToken);
    expect(wallet).toMatchObject({
      displayName:'عميل تجريبي',coins:225.75,tier:'ذهبي',completedVisits:8,
      ownedVouchers:[{id:'31',title:'ماسك وجه',status:'active'}],
      movements:[{id:'51',coinsDelta:25.25}],
    });
    expect(wallet?.ownedVouchers).toHaveLength(1);
    expect(wallet?.movements).toHaveLength(1);
    expect(wallet?.memberCode).not.toContain('ClientID');
    expect((wallet?.coins??0)).not.toBe(9000);
    expect(await loadCutClubWallet('X'.repeat(43))).toBeNull();
  });
  it('an incorrect tenant code cannot mint OTP or restore even a previously valid session',async()=>{
    const issued=await startCutClubOtp(inactiveClient,'LOGIN');
    const auth=await verifyCutClubOtp(issued.pendingToken,'123456');
    expect(await getCutClubSession(auth.sessionToken)).not.toBeNull();
    process.env.CUT_CLUB_AUTH_TENANT_CODE='FOREIGN_TEST';
    try {
      expect(await getCutClubSession(auth.sessionToken)).toBeNull();
      await expect(startCutClubOtp(inactiveClient,'LOGIN'))
        .rejects.toThrow('CUT_CLUB_SCHEMA_NOT_READY');
      expect(provider.send).toHaveBeenCalledTimes(1);
    } finally {
      process.env.CUT_CLUB_AUTH_TENANT_CODE='CUT_SALON_TEST';
    }
  });
  it('one pending OTP can be consumed exactly once with two parallel verify requests',async()=>{
    const issued=await startCutClubOtp(inactiveClient,'LOGIN');
    const outcomes=await Promise.allSettled([
      verifyCutClubOtp(issued.pendingToken,'123456'),
      verifyCutClubOtp(issued.pendingToken,'123456'),
    ]);
    expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect(outcomes.filter(x=>x.status==='rejected')).toHaveLength(1);
    const sessions=await pool!.request().query<{C:number}>(`SELECT COUNT(*) AS C FROM dbo.CutClubCustomerSession`);
    expect(sessions.recordset[0].C).toBe(1);
  });
  it('expired OTP cannot be verified and DRVO is never called',async()=>{
    const issued=await startCutClubOtp(inactiveClient,'LOGIN');
    await pool!.request().input('digest',mssql.Char(64),digestToken(issued.pendingToken)).query(`
      UPDATE dbo.CutClubOtpPending SET ExpiresAtUtc=DATEADD(SECOND,-1,SYSUTCDATETIME())
      WHERE TokenDigest=@digest
    `);
    await expect(verifyCutClubOtp(issued.pendingToken,'123456')).rejects.toThrow('OTP_EXPIRED_OR_USED');
    expect(provider.verify).not.toHaveBeenCalled();
  });
  it('invalid provider OTP, session logout and expiration all fail closed',async()=>{
    const issued=await startCutClubOtp(inactiveClient,'LOGIN');
    provider.verify.mockRejectedValueOnce(Error('INVALID_OTP'));
    await expect(verifyCutClubOtp(issued.pendingToken,'000000')).rejects.toThrow('INVALID_OTP');
    let rows=await pool!.request().query<{C:number}>(`SELECT COUNT(*) AS C FROM dbo.CutClubCustomerSession`);
    expect(rows.recordset[0].C).toBe(0);
    const auth=await verifyCutClubOtp(issued.pendingToken,'123456');
    expect(await getCutClubSession(auth.sessionToken)).not.toBeNull();
    await logoutCutClubSession(auth.sessionToken);
    expect(await getCutClubSession(auth.sessionToken)).toBeNull();
    rows=await pool!.request().query<{C:number}>(`SELECT COUNT(*) AS C FROM dbo.CutClubCustomerSession WHERE RevokedAtUtc IS NOT NULL`);
    expect(rows.recordset[0].C).toBe(1);
  });
});

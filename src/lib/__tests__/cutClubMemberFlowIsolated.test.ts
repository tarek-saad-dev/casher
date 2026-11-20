import { beforeEach,describe,it,expect,vi } from 'vitest';
import { randomUUID } from 'node:crypto';

type Pending={digest:string;phone:string;purpose:string;challengeId:string;status:string;lease:string|null;expires:Date};
type Account={AccountID:string;TenantId:string;PhoneNormalized:string;LegacyClientID:number|null;LinkStatus:'ACTIVE'|'UNLINKED'|'REVIEW_REQUIRED'};
const fake=vi.hoisted(()=>({
  providerSend:vi.fn(),providerVerify:vi.fn(),db:null as any,upcoming:vi.fn(),
}));
vi.mock('@/lib/integrations/drvowaClient',()=>({
  sendDrvowaCutClubOtp:fake.providerSend,
  verifyDrvowaCutClubOtp:fake.providerVerify,
}));
vi.mock('@/lib/booking/publicBookingReader',()=>({
  listPublicUpcomingBookings:fake.upcoming,
}));
vi.mock('@/lib/db',()=>{
  const types={Char:(n:number)=>'char'+n,NVarChar:(n:number)=>'nv'+n,VarChar:(n:number)=>'v'+n,Int:'int',UniqueIdentifier:'uuid',DateTime2:'dt2',ISOLATION_LEVEL:{SERIALIZABLE:'serializable'}};
  class Request{
    params:Record<string,unknown>={};
    constructor(_ctx?:unknown){}
    input(k:string,_t:unknown,v:unknown){this.params[k]=v;return this;}
    async query(q:string){return fake.db.execute(q,this.params);}
  }
  class Transaction{
    constructor(_pool:unknown){}
    async begin(_isolation?:unknown){}
    async commit(){}
    async rollback(){}
  }
  return {getPool:async()=>({request:()=>new Request()}),sql:{...types,Request,Transaction}};
});
import { startCutClubOtp,verifyCutClubOtp,getCutClubSession,logoutCutClubSession,digestToken,revokeCutClubAccountSessions } from '../cut-club/memberOtp';
import { loadCutClubWallet,loadCutClubActivity } from '../cut-club/memberWalletRead';

const tenant='413d433e-f36b-1410-8820-009ec495c7e1';
const phone='201557994946';
class FakeSql {
  pending:Pending|null=null;
  accounts:Account[]=[];
  sessions:{digest:string;account:string;revoked:boolean}[]=[];
  matches:{ClientID:number}[]=[];
  linkedPhoneChanged=false;
  ledger:{LedgerID:number;ClientID:number;MovementType:string;PointsDelta:number;CreatedAt:Date}[]=[];
  async execute(q:string,p:Record<string,any>){
    const ok=(recordset:any[]=[],rowsAffected=[1])=>({recordset,rowsAffected});
    if(q.includes(' AS Ready'))return ok([{Ready:1}]);
    if(q.includes('INSERT dbo.CutClubOtpPending')){
      this.pending={digest:p.digest,phone:p.phone,purpose:p.purpose,challengeId:p.challenge,status:'READY',lease:null,expires:p.expires};return ok();
    }
    if(q.includes("SET Status='VERIFYING'")){
      if(!this.pending||this.pending.digest!==p.digest||this.pending.status!=='READY')return ok([], [0]);
      this.pending.status='VERIFYING';this.pending.lease=p.lease;
      return ok([{PhoneNormalized:this.pending.phone,Purpose:this.pending.purpose,ChallengeID:this.pending.challengeId}]);
    }
    if(q.includes("SET Status='CONSUMED'")){
      if(!this.pending||this.pending.status!=='VERIFYING'||this.pending.lease!==p.lease)return ok([], [0]);
      this.pending.status='CONSUMED';this.pending.lease=null;return ok();
    }
    if(q.includes("SET Status='READY',VerifyLease=NULL")){
      if(this.pending&&this.pending.lease===p.lease){this.pending.status='READY';this.pending.lease=null;}return ok();
    }
    if(q.includes('SELECT TOP (200) c.ClientID')&&!q.includes('ClientName'))return ok(this.matches);
    if(q.includes('FROM dbo.CutClubMemberAccount WITH (UPDLOCK'))return ok(this.accounts.filter(a=>a.PhoneNormalized===p.phone));
    if(q.includes('INSERT dbo.CutClubMemberAccount')){
      const a:Account={AccountID:randomUUID(),TenantId:p.tenant,PhoneNormalized:p.phone,LegacyClientID:null,LinkStatus:p.desired};
      this.accounts.push(a);return ok([{AccountID:a.AccountID}]);
    }
    if(q.includes('UPDATE dbo.CutClubMemberAccount'))return ok([]);
    if(q.includes('INSERT dbo.CutClubCustomerSession')){
      this.sessions.push({digest:p.digest,account:p.account,revoked:false});return ok();
    }
    if(q.includes('FROM dbo.CutClubCustomerSession s')){
      const sess=this.sessions.find(x=>x.digest===p.digest&&!x.revoked);
      if(!sess)return ok([]);
      const a=this.accounts.find(x=>x.AccountID===sess.account)!;
      return ok([{AccountID:a.AccountID,TenantId:a.TenantId,LegacyClientID:a.LegacyClientID,LinkStatus:a.LinkStatus,
        ClientPhoneMatches:a.LinkStatus!=='ACTIVE'?null:(this.linkedPhoneChanged?0:1)}]);
    }
    if(q.includes('UPDATE dbo.CutClubCustomerSession SET RevokedAtUtc')&&p.accountId){
      const live=this.sessions.filter(x=>x.account===p.accountId&&!x.revoked);
      live.forEach(x=>{x.revoked=true;});return ok([], [live.length]);
    }
    if(q.includes('UPDATE dbo.CutClubCustomerSession SET RevokedAtUtc')){
      const s=this.sessions.find(x=>x.digest===p.digest);if(s)s.revoked=true;return ok();
    }
    if(q.includes('SELECT PhoneNormalized FROM dbo.CutClubMemberAccount')){
      const a=this.accounts.find(x=>x.AccountID===p.accountId);return ok(a?[{PhoneNormalized:a.PhoneNormalized}]:[]);
    }
    if(q.includes('SELECT TOP (@take) l.LedgerID')){
      let rows=this.ledger.filter(l=>l.ClientID===p.clientId);
      if(q.includes('l.PointsDelta>0'))rows=rows.filter(l=>l.PointsDelta>0);
      if(q.includes('l.PointsDelta<0'))rows=rows.filter(l=>l.PointsDelta<0);
      rows.sort((a,b)=>b.CreatedAt.getTime()-a.CreatedAt.getTime()||b.LedgerID-a.LedgerID);
      if(p.cAt)rows=rows.filter(l=>l.CreatedAt<p.cAt||(l.CreatedAt.getTime()===p.cAt.getTime()&&l.LedgerID<p.cId));
      return ok(rows.slice(0,p.take));
    }
    if(q.includes('SELECT TOP (2) c.ClientID,c.Name AS ClientName')){
      return ok([{ClientID:7,ClientName:'مستخدم حقيقي',ClientLoyaltyID:8,PointsBalance:250,TierNameAr:'ذهبي',TotalVisits:5}]);
    }
    if(q.includes('FROM dbo.TblClientInventory i')){
      return ok([{InventoryID:31,NameAr:'حمام زيت',Status:'ACTIVE',ExpiresAt:null}]);
    }
    if(q.includes('FROM dbo.TblLoyaltyPointLedger l')){
      return ok([{LedgerID:91,MovementType:'EARN_SALE',PointsDelta:25,CreatedAt:new Date('2026-11-19T10:00:00Z')}]);
    }
    throw Error('Unexpected query '+q.slice(0,100));
  }
}
describe('CUT CLUB OTP → binding → owned wallet state with isolated SQL adapter',()=>{
  beforeEach(()=>{
    fake.db=new FakeSql();
    fake.providerSend.mockReset();fake.providerVerify.mockReset();
    process.env.CUT_CLUB_AUTH_TENANT_ID=tenant;
    process.env.CUT_CLUB_AUTH_TENANT_CODE='CUT_SALON_TEST';
    process.env.CUT_CLUB_MEMBER_WALLET_ENABLED='true';
    fake.providerSend.mockImplementation(async()=>({
      challengeId:randomUUID(),status:'SENT',
      expiresAtUtc:new Date(Date.now()+240_000).toISOString(),
      resendAfterSec:60,idempotentReplay:false,
    }));
    fake.upcoming.mockReset();
    fake.upcoming.mockResolvedValue({bookings:[],meta:{count:0,hasMore:false}});
    fake.providerVerify.mockImplementation(async(p:any)=>({
      verified:true,phoneNormalized:phone,purpose:p.purpose,
    }));
  });
  it('new member verified: durable session, no legacy balance; replay and stolen token denied',async()=>{
    const issued=await startCutClubOtp('01557994946','CUT_CLUB_SIGNUP');
    const authenticated=await verifyCutClubOtp(issued.pendingToken,'123456');
    expect(authenticated.status).toBe('UNLINKED');
    expect(authenticated.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const account=await getCutClubSession(authenticated.sessionToken);
    expect(account?.legacyClientId).toBeNull();
    const projection=await loadCutClubWallet(authenticated.sessionToken);
    expect(projection?.coins).toBeNull();
    expect(projection?.ownedVouchers).toBeNull();
    await expect(verifyCutClubOtp(issued.pendingToken,'123456')).rejects.toThrow('OTP_EXPIRED_OR_USED');
    expect(await getCutClubSession('C'.repeat(43))).toBeNull();
    await logoutCutClubSession(authenticated.sessionToken);
    expect(await getCutClubSession(authenticated.sessionToken)).toBeNull();
  });
  it('matching old phone requires staff review; never infer ownership from OTP alone',async()=>{
    fake.db.matches=[{ClientID:7},{ClientID:8}];
    const issued=await startCutClubOtp('01557994946','LOGIN');
    const auth=await verifyCutClubOtp(issued.pendingToken,'123456');
    expect(auth.status).toBe('REVIEW_REQUIRED');
    const wallet=await loadCutClubWallet(auth.sessionToken);
    expect(wallet?.coins).toBeNull();
    expect(wallet?.movements).toBeNull();
    expect(wallet?.ownedVouchers).toBeNull();
  });
  it('a preapproved, uniquely matching historical account displays real Casher fields',async()=>{
    fake.db.matches=[{ClientID:7}];
    fake.db.accounts.push({AccountID:randomUUID(),TenantId:tenant,PhoneNormalized:phone,LegacyClientID:7,LinkStatus:'ACTIVE'});
    const issued=await startCutClubOtp('01557994946','LOGIN');
    const auth=await verifyCutClubOtp(issued.pendingToken,'123456');
    expect(auth.status).toBe('ACTIVE');
    const wallet=await loadCutClubWallet(auth.sessionToken);
    expect(wallet).toMatchObject({
      displayName:'مستخدم حقيقي',coins:250,tier:'ذهبي',completedVisits:5,
      ownedVouchers:[{id:'31',title:'حمام زيت',status:'active'}],
      movements:[{id:'91',coinsDelta:25,title:'نقاط من زيارة'}],
    });
    expect(wallet).not.toHaveProperty('clientId');
  });
  it('staff-approved identity works even if two old clients share the verified phone',async()=>{
    fake.db.matches=[{ClientID:7},{ClientID:8}];
    fake.db.accounts.push({AccountID:randomUUID(),TenantId:tenant,PhoneNormalized:phone,LegacyClientID:8,LinkStatus:'ACTIVE'});
    const issued=await startCutClubOtp('01557994946','LOGIN');
    const auth=await verifyCutClubOtp(issued.pendingToken,'123456');
    expect(auth.status).toBe('ACTIVE');
    const session=await getCutClubSession(auth.sessionToken);
    expect(session?.legacyClientId).toBe(8);
  });
  it('open session loses the wallet at once if the linked Casher mobile changes',async()=>{
    fake.db.matches=[{ClientID:7}];
    fake.db.accounts.push({AccountID:randomUUID(),TenantId:tenant,PhoneNormalized:phone,LegacyClientID:7,LinkStatus:'ACTIVE'});
    const issued=await startCutClubOtp('01557994946','LOGIN');
    const auth=await verifyCutClubOtp(issued.pendingToken,'123456');
    expect((await getCutClubSession(auth.sessionToken))?.legacyClientId).toBe(7);
    fake.db.linkedPhoneChanged=true;
    const session=await getCutClubSession(auth.sessionToken);
    expect(session).toMatchObject({legacyClientId:null,linkStatus:'REVIEW_REQUIRED'});
    const wallet=await loadCutClubWallet(auth.sessionToken);
    expect(wallet?.coins).toBeNull();
    expect(wallet?.movements).toBeNull();
  });
  it('revoking an account kills every live session of that account only',async()=>{
    const a=await verifyCutClubOtp((await startCutClubOtp('01557994946','LOGIN')).pendingToken,'123456');
    const account=(await getCutClubSession(a.sessionToken))!.accountId;
    // Second device of the same member.
    const b={sessionToken:'B'.repeat(43)};
    fake.db.sessions.push({digest:digestToken(b.sessionToken),account,revoked:false});
    expect((await getCutClubSession(b.sessionToken))?.accountId).toBe(account);
    fake.db.sessions.push({digest:'other',account:randomUUID(),revoked:false});
    const db=await import('@/lib/db');
    const pool={request:()=>new (db.sql as any).Request()};
    expect(await revokeCutClubAccountSessions(pool,tenant,account)).toBe(2);
    expect(await getCutClubSession(a.sessionToken)).toBeNull();
    expect(await getCutClubSession(b.sessionToken)).toBeNull();
    expect(fake.db.sessions.find(x=>x.digest==='other')?.revoked).toBe(false);
  });
  it('wallet shows the next booking of the verified phone; booking failure never breaks the wallet',async()=>{
    fake.upcoming.mockResolvedValueOnce({bookings:[{code:'CUT-AB12',statusLabelAr:'مؤكد',branch:{branchName:'جليم'},
      barber:{nameAr:'كريم'},startDateTime:'2026-11-22T15:00:00+02:00',workDate:'2026-11-22',time:'15:00',
      servicesSummary:'قص شعر',services:[]}],meta:{count:1,hasMore:false}});
    const auth=await verifyCutClubOtp((await startCutClubOtp('01557994946','CUT_CLUB_SIGNUP')).pendingToken,'123456');
    const wallet=await loadCutClubWallet(auth.sessionToken);
    expect(fake.upcoming).toHaveBeenCalledWith(expect.objectContaining({tenantId:tenant,phone:'01557994946',limit:1}));
    // Exact website contract (zod .strict()): no extra keys allowed.
    expect(Object.keys(wallet!.upcomingBooking!).sort()).toEqual(['branch','date','service']);
    expect(wallet?.upcomingBooking).toMatchObject({service:'قص شعر',branch:'جليم'});
    expect(wallet?.upcomingBooking?.date).toMatch(/\S/);
    fake.upcoming.mockRejectedValueOnce(Error('boom'));
    expect((await loadCutClubWallet(auth.sessionToken))?.upcomingBooking).toBeNull();
  });
  it('activity is paginated by keyset, filterable, and only for the linked owner',async()=>{
    fake.db.matches=[{ClientID:7}];
    fake.db.accounts.push({AccountID:randomUUID(),TenantId:tenant,PhoneNormalized:phone,LegacyClientID:7,LinkStatus:'ACTIVE'});
    const t0=Date.parse('2026-11-01T10:00:00Z');
    for(let i=1;i<=5;i++)fake.db.ledger.push({LedgerID:i,ClientID:7,MovementType:i===3?'REDEEM':'EARN_SALE',PointsDelta:i===3?-50:10,CreatedAt:new Date(t0+i*1000)});
    fake.db.ledger.push({LedgerID:99,ClientID:8,MovementType:'EARN_SALE',PointsDelta:999,CreatedAt:new Date(t0+9000)});
    const auth=await verifyCutClubOtp((await startCutClubOtp('01557994946','LOGIN')).pendingToken,'123456');
    const p1=await loadCutClubActivity(auth.sessionToken,{limit:2});
    if(!p1||p1==='INVALID')throw Error('expected page');
    expect(p1.items.map(i=>i.id)).toEqual(['5','4']);
    expect(p1.nextCursor).toBeTruthy();
    const p2=await loadCutClubActivity(auth.sessionToken,{limit:2,cursor:p1.nextCursor});
    if(!p2||p2==='INVALID')throw Error('expected page');
    expect(p2.items.map(i=>i.id)).toEqual(['3','2']);
    const spend=await loadCutClubActivity(auth.sessionToken,{type:'spend'});
    if(!spend||spend==='INVALID')throw Error('expected page');
    expect(spend.items).toEqual([expect.objectContaining({id:'3',coinsDelta:-50,title:'استبدال مكافأة'})]);
    expect(spend.nextCursor).toBeNull();
    expect(await loadCutClubActivity(auth.sessionToken,{cursor:'not-a-cursor'})).toBe('INVALID');
    expect(await loadCutClubActivity(auth.sessionToken,{type:'x'})).toBe('INVALID');
  });
  it('activity is denied for members that are not linked',async()=>{
    const auth=await verifyCutClubOtp((await startCutClubOtp('01557994946','CUT_CLUB_SIGNUP')).pendingToken,'123456');
    expect(await loadCutClubActivity(auth.sessionToken)).toBeNull();
  });
  it('normalizes SQL Server uppercase UUID before verifying DRVO OTP HMAC',async()=>{
    const issued=await startCutClubOtp('01557994946','LOGIN');
    // DRVO hashes lowercase randomUUID() on send, but mssql can read
    // the same UNIQUEIDENTIFIER as uppercase text from CutClubOtpPending.
    const originallyIssued=fake.db.pending!.challengeId;
    fake.db.pending!.challengeId=originallyIssued.toUpperCase();
    fake.providerVerify.mockImplementationOnce(async(p:any)=>{
      if(p.challengeId!==originallyIssued)throw Error('INVALID_OTP');
      return {verified:true,phoneNormalized:phone,purpose:p.purpose};
    });
    const result=await verifyCutClubOtp(issued.pendingToken,'123456');
    expect(result.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fake.providerVerify).toHaveBeenCalledWith(expect.objectContaining({
      challengeId:originallyIssued,
      phone,
      purpose:'LOGIN',
    }));
    expect(fake.db.pending?.status).toBe('CONSUMED');
  });
  it('wrong OTP releases local lease for next attempt but mints NO member session',async()=>{
    const issued=await startCutClubOtp('01557994946','LOGIN');
    fake.providerVerify.mockRejectedValueOnce(Error('INVALID_OTP'));
    await expect(verifyCutClubOtp(issued.pendingToken,'000000')).rejects.toThrow('INVALID_OTP');
    expect(fake.db.sessions.length).toBe(0);
    expect(fake.db.pending?.status).toBe('READY');
  });
});

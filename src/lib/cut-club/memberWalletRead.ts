import 'server-only';
import { getPool, sql } from '@/lib/db';
import { getCutClubSession } from './memberOtp';
import { listPublicUpcomingBookings } from '@/lib/booking/publicBookingReader';

/** Must stay exactly {service,date,branch}: the website validates it with zod .strict(). */
export type MemberUpcomingBooking = { service: string; date: string; branch: string };
export type MemberActivityItem = {id:string;type:string;title:string;occurredAt:string;coinsDelta:number};
export type MemberActivityPage = {items:MemberActivityItem[];nextCursor:string|null};

export type MemberWalletPayload = {
  displayName: string;
  memberCode: string;
  tier: string | null;
  coins: number | null;
  promoCreditMinor: null;
  ownedVouchers: Array<{id:string;title:string;status:'active'|'used'|'expired';expiryLabel:string|null}> | null;
  movements: Array<{id:string;title:string;occurredAtLabel:string;coinsDelta:number}> | null;
  upcomingBooking: MemberUpcomingBooking | null;
  completedVisits: number | null;
  linkStatus: 'ACTIVE'|'UNLINKED'|'REVIEW_REQUIRED';
};

function nonnegative(n: unknown): number | null {
  const x=Number(n);
  return n !== null && n !== undefined && Number.isFinite(x) && x >= 0 && x <= Number.MAX_SAFE_INTEGER && Math.round(x * 100) / 100 === x ? x:null;
}
function moneyLabel(date: Date|null): string|null {
  return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString().slice(0,10) : null;
}
const movementLabels: Record<string,string> = {
  EARN_SALE: 'نقاط من زيارة', ADJUST_ADD:'إضافة نقاط',
  ADJUST_SUBTRACT:'خصم نقاط', REVERSAL:'عكس فاتورة',
  REDEEM:'استبدال مكافأة', STORE_PURCHASE:'شراء مكافأة',
  REFERRAL_BONUS:'مكافأة إحالة',
};

export async function loadCutClubWallet(sessionToken: unknown): Promise<MemberWalletPayload | null> {
  const verified=await getCutClubSession(sessionToken);
  if (!verified) return null;
  if (verified.linkStatus!=='ACTIVE'||!verified.legacyClientId) {
    return {
      displayName:'عضو CUT CLUB', memberCode:'حساب موثّق', tier:null,
      coins:null,promoCreditMinor:null,ownedVouchers:null,movements:null,
      upcomingBooking:await loadUpcomingBooking(verified.tenantId,verified.accountId),
      completedVisits:null,linkStatus:verified.linkStatus,
    };
  }
  const db=await getPool();
  const client=await db.request()
    .input('tenant',sql.UniqueIdentifier,verified.tenantId)
    .input('clientId',sql.Int,verified.legacyClientId)
    .query<{ClientID:number;ClientName:string|null;ClientLoyaltyID:number|null;PointsBalance:number|null;TierNameAr:string|null;TotalVisits:number|null}>(`
      SELECT TOP (2) c.ClientID,c.Name AS ClientName,
        cl.ClientLoyaltyID,cl.PointsBalance,lt.TierNameAr,cl.TotalVisits
      FROM dbo.TblClient c
      LEFT JOIN dbo.TblClientLoyalty cl ON cl.ClientID=c.ClientID AND cl.IsActive=1
      LEFT JOIN dbo.TblLoyaltyTier lt ON lt.TierID=cl.TierID
      WHERE c.TenantId=@tenant AND c.ClientID=@clientId
    `);
  // Do not silently synthesize a zero balance, and deny inconsistent rows.
  if(client.recordset.length!==1) return null;
  const row=client.recordset[0];
  if(row.PointsBalance!==null && nonnegative(row.PointsBalance)===null) return null;
  const vouchers=await db.request()
    .input('tenant',sql.UniqueIdentifier,verified.tenantId)
    .input('clientId',sql.Int,verified.legacyClientId)
    .query<{InventoryID:number;NameAr:string|null;Status:string;ExpiresAt:Date|null}>(`
      SELECT TOP (50) i.InventoryID,s.NameAr,i.Status,i.ExpiresAt
      FROM dbo.TblClientInventory i
      INNER JOIN dbo.TblClient c ON c.ClientID=i.ClientID AND c.TenantId=@tenant
      INNER JOIN dbo.TblLoyaltyStoreItem s ON s.ItemID=i.ItemID
      WHERE i.ClientID=@clientId
      ORDER BY i.PurchasedAt DESC,i.InventoryID DESC
    `);
  const activity=row.ClientLoyaltyID
    ? await db.request().input('tenant',sql.UniqueIdentifier,verified.tenantId)
      .input('clientId',sql.Int,verified.legacyClientId)
      .input('loyaltyId',sql.Int,row.ClientLoyaltyID)
      .query<{LedgerID:number;MovementType:string;PointsDelta:number;CreatedAt:Date}>(`
        SELECT TOP (30) l.LedgerID,l.MovementType,l.PointsDelta,l.CreatedAt
        FROM dbo.TblLoyaltyPointLedger l
        INNER JOIN dbo.TblClient c ON c.ClientID=l.ClientID AND c.TenantId=@tenant
        WHERE l.ClientID=@clientId AND l.ClientLoyaltyID=@loyaltyId
        ORDER BY l.CreatedAt DESC,l.LedgerID DESC
      `)
    : null;
  const v=vouchers.recordset.map(i=>({
    id:String(i.InventoryID),title:String(i.NameAr||'مكافأة CUT CLUB').slice(0,150),
    status:(i.Status==='USED'?'used':i.Status==='ACTIVE' && (i.ExpiresAt===null||new Date(i.ExpiresAt).getTime()>Date.now())?'active':'expired') as 'active'|'used'|'expired',
    expiryLabel:moneyLabel(i.ExpiresAt),
  }));
  const m=(activity?.recordset||[]).map(i=>({
    id:String(i.LedgerID),title:movementLabels[i.MovementType]||'حركة نقاط',
    occurredAtLabel:moneyLabel(i.CreatedAt)||'',coinsDelta:Number(i.PointsDelta),
  }));
  if(m.some(i=>!Number.isFinite(i.coinsDelta) || Math.abs(i.coinsDelta)>Number.MAX_SAFE_INTEGER || Math.round(i.coinsDelta*100)/100 !== i.coinsDelta)) return null;
  return {
    displayName:String(row.ClientName||'عضو CUT CLUB').slice(0,100),
    memberCode:row.ClientLoyaltyID?'CC-'+String(row.ClientLoyaltyID).padStart(6,'0'):'عضو CUT CLUB',
    tier:row.TierNameAr||null,
    coins:nonnegative(row.PointsBalance),
    promoCreditMinor:null, // No authoritative EGP promo-credit source in Casher yet.
    ownedVouchers:v,movements:m,
    upcomingBooking:await loadUpcomingBooking(verified.tenantId,verified.accountId),
    completedVisits:nonnegative(row.TotalVisits),
    linkStatus:'ACTIVE',
  };
}

/**
 * Next booking for the OTP-verified phone itself (not the legacy record), so it
 * also works for members still in review. Never fails the wallet: null on error.
 */
async function loadUpcomingBooking(tenantId:string,accountId:string):Promise<MemberUpcomingBooking|null>{
  try{
    const r=await (await getPool()).request()
      .input('tenant',sql.UniqueIdentifier,tenantId).input('accountId',sql.UniqueIdentifier,accountId)
      .query<{PhoneNormalized:string}>(`
        SELECT PhoneNormalized FROM dbo.CutClubMemberAccount
        WHERE TenantId=@tenant AND AccountID=@accountId
      `);
    const phone=r.recordset[0]?.PhoneNormalized;
    if(!phone||!/^201[0125]\d{8}$/.test(phone))return null;
    const {bookings}=await listPublicUpcomingBookings({tenantId,phone:'0'+phone.slice(2),limit:1});
    const b=bookings[0];
    if(!b)return null;
    const service=(b.servicesSummary??b.services.map(x=>x.nameAr).filter(Boolean).join('، '))||'حجز CUT Salon';
    const start=b.startDateTime?new Date(b.startDateTime):null;
    const date=start&&Number.isFinite(start.getTime())
      ?new Intl.DateTimeFormat('ar-EG',{timeZone:'Africa/Cairo',weekday:'long',day:'numeric',month:'long',hour:'numeric',minute:'2-digit'}).format(start)
      :[b.workDate,b.time].filter(Boolean).join(' ')||'موعد قادم';
    return {service:service.slice(0,150),date:date.slice(0,80),branch:(b.branch?.branchName||'CUT Salon').slice(0,80)};
  }catch{return null;}
}

const ACTIVITY_DEFAULT=20, ACTIVITY_MAX=50;
function decodeCursor(c:unknown):{at:Date;id:number}|null{
  if(typeof c!=='string'||c.length>80)return null;
  try{
    const [iso,id]=Buffer.from(c,'base64url').toString('utf8').split('|');
    const at=new Date(iso),n=Number(id);
    return Number.isFinite(at.getTime())&&Number.isSafeInteger(n)&&n>0?{at,id:n}:null;
  }catch{return null;}
}
const encodeCursor=(at:Date,id:number)=>Buffer.from(at.toISOString()+'|'+id,'utf8').toString('base64url');

/**
 * Paginated coins history of the session owner only. Keyset on (CreatedAt,LedgerID)
 * so new movements never shift pages. `type`: all | earn | spend.
 * Returns null if the session is not an ACTIVE linked member.
 */
export async function loadCutClubActivity(sessionToken:unknown,opts:{cursor?:unknown;limit?:unknown;type?:unknown}={}):Promise<MemberActivityPage|null|'INVALID'>{
  const verified=await getCutClubSession(sessionToken);
  if(!verified||verified.linkStatus!=='ACTIVE'||!verified.legacyClientId)return null;
  const limitN=opts.limit===undefined||opts.limit===null||opts.limit===''?ACTIVITY_DEFAULT:Number(opts.limit);
  if(!Number.isInteger(limitN)||limitN<1)return 'INVALID';
  const limit=Math.min(limitN,ACTIVITY_MAX);
  const type=opts.type===undefined||opts.type===null||opts.type===''?'all':opts.type;
  if(type!=='all'&&type!=='earn'&&type!=='spend')return 'INVALID';
  const cursor=opts.cursor===undefined||opts.cursor===null||opts.cursor===''?null:decodeCursor(opts.cursor);
  if(opts.cursor&&!cursor)return 'INVALID';
  const req=(await getPool()).request()
    .input('tenant',sql.UniqueIdentifier,verified.tenantId)
    .input('clientId',sql.Int,verified.legacyClientId)
    .input('take',sql.Int,limit+1);
  if(cursor)req.input('cAt',sql.DateTime2,cursor.at).input('cId',sql.Int,cursor.id);
  const r=await req.query<{LedgerID:number;MovementType:string;PointsDelta:number;CreatedAt:Date}>(`
    SELECT TOP (@take) l.LedgerID,l.MovementType,l.PointsDelta,l.CreatedAt
    FROM dbo.TblLoyaltyPointLedger l
    INNER JOIN dbo.TblClient c ON c.ClientID=l.ClientID AND c.TenantId=@tenant
    INNER JOIN dbo.TblClientLoyalty cl ON cl.ClientLoyaltyID=l.ClientLoyaltyID
      AND cl.ClientID=l.ClientID AND cl.IsActive=1
    WHERE l.ClientID=@clientId
      ${type==='earn'?'AND l.PointsDelta>0':type==='spend'?'AND l.PointsDelta<0':''}
      ${cursor?'AND (l.CreatedAt<@cAt OR (l.CreatedAt=@cAt AND l.LedgerID<@cId))':''}
    ORDER BY l.CreatedAt DESC,l.LedgerID DESC
  `);
  const rows=r.recordset.slice(0,limit);
  const items=rows.map(i=>({
    id:String(i.LedgerID),type:i.MovementType,title:movementLabels[i.MovementType]||'حركة نقاط',
    occurredAt:new Date(i.CreatedAt).toISOString(),coinsDelta:Number(i.PointsDelta),
  }));
  if(items.some(i=>!Number.isFinite(i.coinsDelta)||Math.round(i.coinsDelta*100)/100!==i.coinsDelta))return null;
  const last=rows[rows.length-1];
  return {items,nextCursor:r.recordset.length>limit&&last?encodeCursor(new Date(last.CreatedAt),last.LedgerID):null};
}

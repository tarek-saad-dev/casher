import 'server-only';
import { getPool, sql } from '@/lib/db';
import { getCutClubSession } from './memberOtp';

export type MemberWalletPayload = {
  displayName: string;
  memberCode: string;
  tier: string | null;
  coins: number | null;
  promoCreditMinor: null;
  ownedVouchers: Array<{id:string;title:string;status:'active'|'used'|'expired';expiryLabel:string|null}> | null;
  movements: Array<{id:string;title:string;occurredAtLabel:string;coinsDelta:number}> | null;
  upcomingBooking: null;
  completedVisits: number | null;
  linkStatus: 'ACTIVE'|'UNLINKED'|'REVIEW_REQUIRED';
};

function nonnegative(n: unknown): number | null {
  const x=Number(n);
  return n !== null && n !== undefined && Number.isSafeInteger(x) && x >= 0 ? x:null;
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
      upcomingBooking:null,completedVisits:null,linkStatus:verified.linkStatus,
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
  if(m.some(i=>!Number.isSafeInteger(i.coinsDelta))) return null;
  return {
    displayName:String(row.ClientName||'عضو CUT CLUB').slice(0,100),
    memberCode:row.ClientLoyaltyID?'CC-'+String(row.ClientLoyaltyID).padStart(6,'0'):'عضو CUT CLUB',
    tier:row.TierNameAr||null,
    coins:nonnegative(row.PointsBalance),
    promoCreditMinor:null, // No authoritative EGP promo-credit source in Casher yet.
    ownedVouchers:v,movements:m,
    upcomingBooking:null,completedVisits:nonnegative(row.TotalVisits),
    linkStatus:'ACTIVE',
  };
}

import 'server-only';
import {getPool,sql} from '@/lib/db';
import {getCutClubSession} from './memberOtp';

/**
 * Read-only member storefront projection. No clientId/phone query parameters,
 * no purchase side effects, and no exposing another tenant's branch stock.
 * The pilot lists only approved global reward IDs; branch-specific inventory
 * requires separately reviewed tenant-owned branch mapping.
 */
const approved:Readonly<Record<number,number>>=Object.freeze({
  15:39, // Face Mask
  16:22, // Oil Bath
  17:11, // Basic SkinCare
  18:9,  // Hair Cut
});
export type CutClubReward={
  id:number;nameAr:string;nameEn:string;description:string;
  priceCoins:number;serviceId:number|null;
  stockState:'available'|'out_of_stock';
  expiresAfterDays:number|null;canAfford:boolean|null;
  serviceMappingReady:boolean;purchaseAvailable:false;
};
export type CutClubCatalog={
  balance:number|null;purchaseEnabled:false;items:CutClubReward[];
};

function safeCoins(v:unknown):number|null{
  if(v===null||v===undefined)return null;
  const n=Number(v);
  return Number.isFinite(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER&&Math.round(n*100)/100===n?n:null;
}

export async function loadMemberRewardCatalog(token:unknown):Promise<CutClubCatalog|null>{
  const member=await getCutClubSession(token);
  if(!member||member.linkStatus==='SUSPENDED')return null;
  let balance:number|null=null;
  const db=await getPool();
  if(member.linkStatus==='ACTIVE'&&member.legacyClientId){
    const b=await db.request()
      .input('tenant',sql.UniqueIdentifier,member.tenantId)
      .input('clientId',sql.Int,member.legacyClientId)
      .query<{PointsBalance:number|null}>(`
        SELECT TOP(2) l.PointsBalance
        FROM dbo.TblClient c
        INNER JOIN dbo.TblClientLoyalty l ON l.ClientID=c.ClientID AND l.IsActive=1
        WHERE c.TenantId=@tenant AND c.ClientID=@clientId
      `);
    if(b.recordset.length===1)balance=safeCoins(b.recordset[0].PointsBalance);
  }
  const found=await db.request().query<{
    ItemID:number;NameAr:string|null;NameEn:string|null;DescriptionAr:string|null;
    PriceCoins:number;ServiceID:number|null;StockQuantity:number|null;
    UnlimitedStock:boolean;ExpiresAfterDays:number|null;
  }>(`
    SELECT TOP(4) ItemID,NameAr,NameEn,DescriptionAr,PriceCoins,ServiceID,
      StockQuantity,UnlimitedStock,ExpiresAfterDays
    FROM dbo.TblLoyaltyStoreItem
    WHERE ItemID IN (15,16,17,18)
      AND SalonID IS NULL AND IsActive=1 AND ItemType='FREE_SERVICE'
      AND PriceCoins>=0
    ORDER BY SortOrder,ItemID
  `);
  const items:CutClubReward[]=found.recordset.flatMap(row=>{
    if(!(row.ItemID in approved))return [];
    const price=safeCoins(row.PriceCoins);
    if(price===null)return [];
    const stockState=row.UnlimitedStock||Number(row.StockQuantity)>0?'available':'out_of_stock';
    const desc=(row.DescriptionAr||'').trim().slice(0,350);
    return [{
      id:row.ItemID,
      nameAr:String(row.NameAr||'مكافأة CUT CLUB').slice(0,100),
      nameEn:String(row.NameEn||'CUT CLUB Reward').slice(0,100),
      description:desc,
      priceCoins:price,
      serviceId:row.ServiceID===approved[row.ItemID]?row.ServiceID:null,
      stockState,
      expiresAfterDays:Number.isSafeInteger(row.ExpiresAfterDays)&&row.ExpiresAfterDays!>0?row.ExpiresAfterDays:null,
      canAfford:balance===null?null:balance>=price,
      serviceMappingReady:row.ServiceID===approved[row.ItemID],
      purchaseAvailable:false as const,
    }];
  });
  return {balance,purchaseEnabled:false,items};
}

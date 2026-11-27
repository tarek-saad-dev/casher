import {NextRequest,NextResponse} from 'next/server';
import {getPool,sql} from '@/lib/db';
import {secureBffKey,cutClubTenant,ClubAuthError} from '@/lib/cut-club/memberOtp';
import {purchaseRewardWithVerifiedSession,type RewardOwner} from '@/lib/cut-club/stagingRewardSettlement';
import {stageRewardPoolReady,createStageSqlRewardPurchasePort} from '@/lib/cut-club/stagingRewardSqlPort';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store, max-age=0','X-Robots-Tag':'noindex'};
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers});
const validKey=(s:unknown):s is string=>typeof s==='string'&&/^[A-Za-z0-9_-]{20,64}$/.test(s);

/**
 * Integration pilot only. There is deliberately NO matching website purchase
 * BFF yet. Production last132 categorically fails the DB/login guard both
 * BEFORE and INSIDE the SERIALIZABLE transaction, even if a flag is set.
 */
export async function POST(req:NextRequest){
  if(!secureBffKey(req.headers.get('authorization')))
    return reply({ok:false,code:'UNAUTHORIZED'},401);
  if(process.env.CUT_CLUB_STAGING_REWARD_PURCHASE_ENABLED!=='true')
    return reply({ok:false,code:'REWARD_PURCHASE_NOT_RELEASED'},403);
  const length=Number(req.headers.get('content-length')||'0');
  if(!Number.isFinite(length)||length>1024)
    return reply({ok:false,code:'INVALID_REQUEST'},400);
  let data:unknown;
  try{data=await req.json();}catch{return reply({ok:false,code:'INVALID_REQUEST'},400);}
  if(!data||typeof data!=='object'||Array.isArray(data)||
     Object.keys(data).sort().join(',')!=='idempotencyKey,itemId')
    return reply({ok:false,code:'INVALID_REQUEST'},400);
  const {itemId,idempotencyKey}=data as {itemId:unknown;idempotencyKey:unknown};
  if(!Number.isSafeInteger(itemId)||![15,16,17,18].includes(itemId as number)||!validKey(idempotencyKey))
    return reply({ok:false,code:'INVALID_REQUEST'},400);

  try{
    const tenant=cutClubTenant();
    // This is a CUT Salon only pilot. No guessed demo tenant/account mapping.
    if(tenant!=='413d433e-f36b-1410-8820-009ec495c7e1'||
       process.env.CUT_CLUB_AUTH_TENANT_CODE!=='CASHER_BOOT')
      return reply({ok:false,code:'PURCHASE_SCOPE_NOT_APPROVED'},403);
    const branchId=Number(process.env.CUT_CLUB_STAGING_REWARD_BRANCH_ID);
    if(!Number.isSafeInteger(branchId)||branchId<1)
      return reply({ok:false,code:'PURCHASE_SCOPE_NOT_APPROVED'},403);
    const allowlist=process.env.CUT_CLUB_STAGING_REWARD_APPROVED_BRANCHES_JSON;
    let approved:unknown;
    try{approved=JSON.parse(allowlist||'');}catch{return reply({ok:false,code:'PURCHASE_SCOPE_NOT_APPROVED'},403);}
    if(!Array.isArray(approved)||approved.length===0||approved.length>10||
       !approved.every(x=>typeof x==='string')||
       !approved.some(x=>x.toLowerCase()===tenant+':'+branchId))
      return reply({ok:false,code:'PURCHASE_SCOPE_NOT_APPROVED'},403);
    const pool=await getPool();
    const result=await purchaseRewardWithVerifiedSession({
      enabled:true,trustedTenantId:tenant,trustedBranchId:branchId,
      cookieToken:req.headers.get('x-cut-club-session'),
      nowSeconds:Math.floor(Date.now()/1000),
      itemId:itemId as number,idempotencyKey,
      stageReady:()=>stageRewardPoolReady(pool),
      verifyOwnedCustomerAndBranch:async(owner:RewardOwner)=>{
        const found=await pool.request()
          .input('tenant',sql.UniqueIdentifier,owner.tenantId)
          .input('clientId',sql.Int,owner.customerId)
          .input('branchId',sql.Int,owner.branchId)
          .query<{ClientID:number;BranchID:number}>(`
            SELECT TOP (2) c.ClientID,b.BranchID
            FROM dbo.TblClient c
            CROSS JOIN dbo.TblBranch b
            INNER JOIN dbo.Tenant t ON t.TenantId=c.TenantId
            WHERE c.ClientID=@clientId AND c.TenantId=@tenant
              AND t.Code='CASHER_BOOT' AND t.Status='active'
              AND b.BranchID=@branchId AND b.BranchName IN (N'جليم – سابا باشا',N'كامب شيزار')
          `);
        return found.recordset.length===1;
      },
      port:createStageSqlRewardPurchasePort(pool),
    });
    if(!result.ok)return reply({ok:false,code:'REWARD_PURCHASE_UNAVAILABLE'},409);
    return reply({ok:true,...result});
  }catch(err){
    if(err instanceof ClubAuthError)return reply({ok:false,code:err.code},err.status);
    return reply({ok:false,code:'REWARD_PURCHASE_UNAVAILABLE'},503);
  }
}
export async function GET(){return reply({ok:false,code:'REWARD_PURCHASE_NOT_RELEASED'},403);}
export async function OPTIONS(){return reply({ok:false,code:'REWARD_PURCHASE_NOT_RELEASED'},403);}

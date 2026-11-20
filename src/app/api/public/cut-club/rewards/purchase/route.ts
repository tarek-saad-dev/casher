import { NextRequest, NextResponse } from 'next/server';
import { secureBffKey } from '@/lib/cut-club/memberOtp';
import { purchaseMemberReward } from '@/lib/cut-club/memberRewards';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={ 'Cache-Control':'private, no-store, max-age=0','X-Robots-Tag':'noindex','X-Content-Type-Options':'nosniff' };
const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,headers});
const statusFor:Record<string,number>={
  disabled:503,session_required:401,not_linked:403,not_eligible:409,
  insufficient_coins:409,out_of_stock:409,conflict:409,unavailable:503,
};

/**
 * BFF-only Coins purchase. Body: {itemId:number, idempotencyKey:string(20-64)}.
 * The customer is ONLY the verified session owner; retries with the same key
 * return the same receipt and never charge twice.
 */
export async function POST(req:NextRequest){
  if(!secureBffKey(req.headers.get('authorization')))return reply({ok:false,code:'UNAUTHORIZED'},401);
  const body=await req.json().catch(()=>null) as {itemId?:unknown;idempotencyKey?:unknown}|null;
  if(!body||!Number.isSafeInteger(body.itemId)||(body.itemId as number)<=0||
      typeof body.idempotencyKey!=='string'||!/^[A-Za-z0-9_-]{20,64}$/.test(body.idempotencyKey))
    return reply({ok:false,code:'INVALID_REQUEST'},400);
  try{
    const r=await purchaseMemberReward(req.headers.get('x-cut-club-session'),body.itemId,body.idempotencyKey);
    if(!r.ok)return reply({ok:false,code:r.reason.toUpperCase()},statusFor[r.reason]??503);
    return reply({ok:true,replayed:r.replayed,receipt:{
      itemId:r.receipt.itemId,voucherId:String(r.receipt.inventoryId),
      coinsCharged:r.receipt.coinsCharged,balanceAfter:r.receipt.balanceAfter,
      voucherCode:r.receipt.voucherCode,
    }});
  }catch{return reply({ok:false,code:'CUT_CLUB_UNAVAILABLE'},503);}
}

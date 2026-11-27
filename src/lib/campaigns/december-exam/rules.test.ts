import { describe, expect, it } from "vitest";
import { evaluateDecember, type DecemberFacts, type DecemberRates } from "./rules";
const rates: DecemberRates = { firstVisit:10, student:10, club:5, multiService:5, friends:[20,45,75] };
const base: DecemberFacts = {active:true,registered:true,alreadyRedeemed:false,firstVisit:true,
  studentVerified:true,clubActive:true,eligiblePaidServiceIds:["a","b"],clientId:"owner",referrals:[]};
const ref = (clientId:string, firstVisitCompleted=true, voided=false) => ({clientId,firstVisitCompleted,voided});
describe("December Exam rules (fixture rates only)",()=>{
  it("blocks inactive, unregistered and already redeemed clients",()=>{
    for (const [patch,reason] of [[{active:false},"INACTIVE"],[{registered:false},"REGISTRATION_REQUIRED"],[{alreadyRedeemed:true},"ALREADY_REDEEMED"]] as const){
      expect(evaluateDecember({...base,...patch},rates,40000)).toMatchObject({reason,percent:0,discountPiasters:0,payablePiasters:40000});
    }
  });
  it("caps payable at zero and applies only highest referral tier",()=>{
    const result=evaluateDecember({...base,referrals:[ref("a"),ref("b"),ref("c"),ref("d")]},rates,40000);
    expect(result).toMatchObject({rawPercent:105,percent:100,payablePiasters:0,qualifyingFriends:4});
    expect(result.rules.filter(r=>r.code==="REFERRAL")).toEqual([{code:"REFERRAL",percent:75}]);
  });
  it("ignores self referrals, duplicates, pending and voided visits",()=>{
    expect(evaluateDecember({...base,referrals:[ref("owner"),ref("a"),ref("a"),ref("b",false),ref("c",true,true)]},rates,40000)).toMatchObject({qualifyingFriends:1,percent:50});
  });
  it("does not reward repeated copies of one service or unverified claims",()=>{
    expect(evaluateDecember({...base,firstVisit:false,studentVerified:false,clubActive:false,eligiblePaidServiceIds:["a","a"]},rates,40000).percent).toBe(0);
  });
  it("uses supplied campaign rates and integer piasters",()=>{
    expect(evaluateDecember({...base,studentVerified:false,clubActive:false,eligiblePaidServiceIds:[]}, {...rates,firstVisit:15},101)).toMatchObject({percent:15,discountPiasters:15,payablePiasters:86});
  });
  it("rejects invalid rates and unsafe amounts",()=>{
    expect(()=>evaluateDecember(base,{...rates,friends:[20,10,30]},40000)).toThrow("INVALID_CAMPAIGN_RATES");
    expect(()=>evaluateDecember(base,rates,-1)).toThrow("INVALID_SUBTOTAL");
    expect(()=>evaluateDecember(base,rates,0.5)).toThrow("INVALID_SUBTOTAL");
  });
});

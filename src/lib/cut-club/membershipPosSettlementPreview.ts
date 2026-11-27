import {computeInvoiceItemsTotals} from '@/lib/sales/service-line-totals';
import {previewBenefit,type BenefitCatalogService} from './membershipBenefitPreview';
import type {BenefitRule} from './membershipBenefitDraft';
/**
 * Pure settlement plan for future transaction-owned integration. Not an
 * authorization or a write path. All prices/rules/usage must be resolved by
 * the server in the invoice transaction; never deserialize this context.
 */
export type SettlementLine={serviceId:number;qty:number;catalog:BenefitCatalogService;bonus:number;existingDiscountMinor:number;existingDiscountBps:number};
export type SettlementProposal={lines:readonly SettlementLine[];rule:BenefitRule;branchId:1|3;usedMembership:number;headerDiscountMinor:number;headerDiscountBps:number;paymentMinor:readonly number[]};
export type SettlementFailure='INVALID_INPUT'|'STACKING_NOT_SUPPORTED'|'SERVICE_AMBIGUOUS'|'BENEFIT_LIMIT_OR_PRICE'|'BONUS_SETTLEMENT_NOT_SUPPORTED'|'ZERO_TOTAL_NOT_SUPPORTED'|'PAYMENT_TOTAL_MISMATCH'|'LEGACY_COLUMN_LIMIT'|'TOTALS_MISMATCH';
const int=(n:number,min:number,max:number)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const MAX_LINE_MINOR=9999999999; // decimal(10,2)
const MAX_DISCOUNT_MINOR=99999999; // decimal(8,2)
const rejected=(code:SettlementFailure)=>({ok:false as const,code});
export function planMembershipSettlementPreview(p:SettlementProposal){
 if(!p.lines.length||p.lines.length>100||!p.paymentMinor.length||p.paymentMinor.length>20||(p.branchId!==1&&p.branchId!==3)||!int(p.headerDiscountMinor,0,MAX_LINE_MINOR)||!int(p.headerDiscountBps,0,10000)||!p.paymentMinor.every(n=>int(n,1,MAX_LINE_MINOR)))return rejected('INVALID_INPUT');
 if(p.lines.some(l=>!int(l.serviceId,1,2147483647)||l.catalog.id!==l.serviceId||!int(l.qty,1,100)||!int(l.catalog.priceMinor,1,100000000)||!Number.isFinite(l.bonus)||l.bonus<0||!int(l.existingDiscountMinor,0,MAX_LINE_MINOR)||!int(l.existingDiscountBps,0,10000)))return rejected('INVALID_INPUT');
 if(p.headerDiscountMinor||p.headerDiscountBps||p.lines.some(l=>l.existingDiscountMinor||l.existingDiscountBps))return rejected('STACKING_NOT_SUPPORTED');
 const target=p.lines.map((l,i)=>l.serviceId===p.rule.serviceId?i:-1).filter(i=>i>=0);
 if(target.length!==1)return rejected('SERVICE_AMBIGUOUS');
 const index=target[0],line=p.lines[index]!;
 if(p.rule.kind==='BONUS_COINS')return rejected('BONUS_SETTLEMENT_NOT_SUPPORTED');
 const quote=previewBenefit(p.rule,line.catalog,p.branchId,line.qty,p.usedMembership,0);
 if(!quote)return rejected('BENEFIT_LIMIT_OR_PRICE');
 const gross=p.lines.reduce((sum,l)=>sum+l.qty*l.catalog.priceMinor,0);
 const net=gross-quote.discountMinor;
 if(!int(gross,1,MAX_LINE_MINOR)||quote.discountMinor>MAX_DISCOUNT_MINOR)return rejected('LEGACY_COLUMN_LIMIT');
 if(net===0)return rejected('ZERO_TOTAL_NOT_SUPPORTED');
 if(p.paymentMinor.reduce((sum,n)=>sum+n,0)!==net)return rejected('PAYMENT_TOTAL_MISMATCH');
 // The existing create/update money calculator is used as a consistency check,
 // not as a substitute for authoritative price/eligibility.
 const lines=p.lines.map((l,i)=>({sPrice:l.catalog.priceMinor/100,qty:l.qty,bonus:l.bonus,discountValue:i===index?quote.discountMinor/100:0}));
 const computed=computeInvoiceItemsTotals(lines,{discountPercent:0,discountValue:0});
 if(Math.round(computed.subTotal*100)!==gross||Math.round(computed.grandTotal*100)!==net||Math.round(computed.lineDiscountTotal*100)!==quote.discountMinor||computed.headerDiscountValue!==0||Math.round(computed.lines[index]!.netAmount*100)!==quote.finalMinor)return rejected('TOTALS_MISMATCH');
 return {ok:true as const,previewOnly:true as const,financialWritesEnabled:false as const,lineIndex:index,quote,computed,remainingAfter:p.rule.maxUsesPerMembership-p.usedMembership-line.qty};
}

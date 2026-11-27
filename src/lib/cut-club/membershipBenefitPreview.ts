import type {BenefitRule} from './membershipBenefitDraft';
export type BenefitCatalogService={id:number;name:string;priceMinor:number};
export type BenefitQuote={originalMinor:number;discountMinor:number;finalMinor:number;bonusCoins:number;units:number;previewOnly:true};
const int=(v:number,min:number,max:number)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
/** Simulated single-service line, no account authorization or usage ledger. All values integer minor units. */
export function previewBenefit(rule:BenefitRule,service:BenefitCatalogService,branchId:number,quantity:number,usedMembership:number,usedInvoice:number):BenefitQuote|null{
 if(service.id!==rule.serviceId||!rule.branchIds.includes(branchId as 1|3)||!int(service.priceMinor,1,100000000)||!int(quantity,1,100)||!int(usedMembership,0,10000)||!int(usedInvoice,0,100))return null;
 if(!int(rule.maxUsesPerMembership,1,10000)||!int(rule.maxUsesPerInvoice,1,100)||rule.maxUsesPerInvoice>rule.maxUsesPerMembership)return null;
 if(quantity>rule.maxUsesPerMembership-usedMembership||quantity>rule.maxUsesPerInvoice-usedInvoice)return null;
 const price=service.priceMinor;let perUnit=0,coins=0;
 switch(rule.kind){
 case 'PERCENT_DISCOUNT':if(!int(rule.value,1,10000))return null;perUnit=Math.floor(price*rule.value/10000);break;
 case 'FREE_SERVICE':if(rule.value!==0)return null;perUnit=price;break;
 case 'FIXED_PRICE':if(!int(rule.value,1,price))return null;perUnit=price-rule.value;break;
 case 'BONUS_COINS':if(!int(rule.value,1,100000)||usedInvoice!==0)return null;coins=rule.value*quantity;break;
 default:return null;
 }
 return {originalMinor:price*quantity,discountMinor:perUnit*quantity,finalMinor:(price-perUnit)*quantity,bonusCoins:coins,units:quantity,previewOnly:true};
}

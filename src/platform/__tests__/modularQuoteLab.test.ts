import fs from 'node:fs';
import path from 'node:path';
import { describe,expect,it } from 'vitest';
import {
  simulateModularResearchInquiry,ModularQuoteLabError,QUOTE_LAB_SALE_BLOCKERS,
  type ResearchInquirySnapshot,type ReviewedTariffSnapshot,
} from '@/platform/commercial/modularQuoteLab';
import {RESEARCH_SALON_APPS} from '@/platform/commercial/tariffResearchPolicy';

const prices=Object.fromEntries(RESEARCH_SALON_APPS.map(code=>[code,2000]));
const inquiry:ResearchInquirySnapshot={
  requestId:'11111111-1111-4111-8111-111111111111',
  tenantId:'22222222-2222-4222-8222-222222222222',tenantCode:'TEST_SALON',
  status:'awaiting_pricing',industry:'salon',draftRevision:3,
  apps:['booking','pos','queue'],branches:3,billingCycle:'annual',
};
const proposal:ReviewedTariffSnapshot={
  proposalId:'33333333-3333-4333-8333-333333333333',
  industry:'salon',version:7,status:'reviewed_research',
  createdByUserId:10,reviewedByUserId:11,reviewedAt:'2026-10-26T04:00:00Z',
  reviewNote:'Internal research assumptions checked',
  pricingModel:'per_app',appPricesMinor:prices,
  baseMonthlyMinor:1000,extraBranchMonthlyMinor:500,
  includedBranches:1,annualMonthsCharged:10,currency:'EGP',
};
function code(fn:()=>unknown):string {
  try{fn();return 'NO_ERROR';}catch(e){
    return e instanceof ModularQuoteLabError?e.code:(e as {code?:string})?.code??'OTHER_ERROR';
  }
}
const read=(file:string)=>fs.readFileSync(path.join(process.cwd(),file),'utf8');

describe('operator quote lab: research only with immutable inquiry inputs',()=>{
  it('calculates deterministic piasters from reviewed research and never returns a payable quote',()=>{
    const r=simulateModularResearchInquiry(inquiry,proposal);
    expect(r).toMatchObject({
      mode:'operator_internal_research_simulation',
      requestId:inquiry.requestId,tenantId:inquiry.tenantId,
      proposalId:proposal.proposalId,proposalVersion:7,
      canIssueCustomerQuote:false,canAcceptOrder:false,
      canCheckout:false,canActivate:false,paid:false,
      orderCreated:false,subscriptionChanged:false,
      researchQuote:{
        kind:'internal_research_only',approvedForSale:false,
        canCheckout:false,canActivate:false,catalogVersion:7,
        cycle:'annual',branches:3,chargedMonths:10,
        totalMonthlyMinor:8000,totalPeriodMinor:80000,
      },
    });
    expect(r.researchQuote.lines.find(x=>x.code==='extra-branch')).toMatchObject({
      quantity:2,unitMonthlyMinor:500,totalMonthlyMinor:1000,
    });
    expect(r.commercialBlockers).toEqual(QUOTE_LAB_SALE_BLOCKERS);
    expect(r.commercialBlockers.length).toBeGreaterThanOrEqual(5);
  });
  it('honors explicit zero rates but never treats missing catalog prices as free',()=>{
    expect(simulateModularResearchInquiry(inquiry,{
      ...proposal,appPricesMinor:{...prices,booking:0},
    }).researchQuote.lines.find(x=>x.code==='booking')?.unitMonthlyMinor).toBe(0);
    expect(code(()=>simulateModularResearchInquiry(inquiry,{
      ...proposal,appPricesMinor:{booking:0},
    }))).toBe('INCOMPLETE_APP_PRICES');
  });
  it('rejects unreviewed, self-reviewed, invalid reviewer and closed inquiries',()=>{
    expect(code(()=>simulateModularResearchInquiry(inquiry,{
      ...proposal,status:'submitted',
    }))).toBe('RESEARCH_NOT_INDEPENDENTLY_REVIEWED');
    expect(code(()=>simulateModularResearchInquiry(inquiry,{
      ...proposal,reviewedByUserId:10,
    }))).toBe('RESEARCH_NOT_INDEPENDENTLY_REVIEWED');
    expect(code(()=>simulateModularResearchInquiry(inquiry,{
      ...proposal,reviewedByUserId:null,
    }))).toBe('RESEARCH_NOT_INDEPENDENTLY_REVIEWED');
    expect(code(()=>simulateModularResearchInquiry(inquiry,{
      ...proposal,reviewNote:'',
    }))).toBe('RESEARCH_NOT_INDEPENDENTLY_REVIEWED');
    expect(code(()=>simulateModularResearchInquiry({...inquiry,status:'closed'},proposal)))
      .toBe('INQUIRY_CLOSED');
  });
  it('refuses wrong industry, stale/incomplete app snapshot, bad cycles and branch bounds',()=>{
    expect(code(()=>simulateModularResearchInquiry({
      ...inquiry,industry:'supermarket',
    },proposal))).toBe('INDUSTRY_MISMATCH');
    expect(code(()=>simulateModularResearchInquiry({
      ...inquiry,apps:['pos'],
    },proposal))).toBe('REQUIRED_APP_MISSING');
    expect(code(()=>simulateModularResearchInquiry({
      ...inquiry,apps:['booking','ai-receptionist'],
    },proposal))).toBe('APP_NOT_PRICEABLE');
    expect(code(()=>simulateModularResearchInquiry({
      ...inquiry,apps:['booking','booking'],
    },proposal))).toBe('APPS_DUPLICATED');
    expect(code(()=>simulateModularResearchInquiry({
      ...inquiry,branches:21,
    },proposal))).toBe('BRANCH_COUNT_INVALID');
    expect(code(()=>simulateModularResearchInquiry({
      ...inquiry,billingCycle:'weekly' as 'monthly',
    },proposal))).toBe('CYCLE_INVALID');
    expect(code(()=>simulateModularResearchInquiry({
      ...inquiry,draftRevision:0,
    },proposal))).toBe('INQUIRY_INVALID');
    expect(code(()=>simulateModularResearchInquiry(inquiry,{
      ...proposal,currency:'USD' as 'EGP',
    }))).toBe('RESEARCH_INVALID');
  });
  it('rejects unsafe values and overflowing computations',()=>{
    expect(code(()=>simulateModularResearchInquiry(inquiry,{
      ...proposal,appPricesMinor:{...prices,pos:-1},
    }))).toBe('INVALID_MINOR_AMOUNT');
    expect(code(()=>simulateModularResearchInquiry(inquiry,{
      ...proposal,appPricesMinor:{...prices,pos:1.5},
    }))).toBe('INVALID_MINOR_AMOUNT');
    expect(code(()=>simulateModularResearchInquiry(inquiry,{
      ...proposal,extraBranchMonthlyMinor:2**53,
    }))).toBe('INVALID_MINOR_AMOUNT');
  });
});

describe('quote lab operator-only API and UI release guards',()=>{
  it('POST uses operator RBAC, accepts only two saved IDs and prohibits price inputs',()=>{
    const route=read('src/app/api/admin/platform/modular-quote-lab/route.ts');
    expect(route).toContain('await requirePlatformOperator()');
    expect(route).toContain("Object.keys(obj).length!==2");
    expect(route).toContain("['requestId','proposalId']");
    expect(route).toContain("'Cache-Control':'no-store'");
    expect(route).not.toContain("export async function GET");
    expect(route).not.toContain('body.price');
    expect(route).not.toContain('body.tenantId');
    expect(route).not.toContain('createPaymentIntent');
  });
  it('only reads tenant-bound SQL rows and does no DB writes or mutation',()=>{
    const service=read('src/platform/commercial/modularQuoteLabService.ts');
    expect(service).toContain('FROM dbo.TenantModularQuoteRequest r');
    expect(service).toContain('INNER JOIN dbo.Tenant t ON t.TenantId=r.TenantId');
    expect(service).toContain('INNER JOIN dbo.TenantIndustryPack pack');
    expect(service).toContain('WHERE r.RequestId=@requestId');
    expect(service).toContain('WHERE ProposalId=@proposalId');
    expect(service).toContain('return simulateModularResearchInquiry(inquirySnapshot,proposalSnapshot)');
    expect(service).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bMERGE\b/i);
  });
  it('separates internal pricing from billing and does not enable checkout actions',()=>{
    const component=read('src/components/platform/ModularQuoteLabClient.tsx');
    const page=read('src/app/platform/modular-quote-lab/page.tsx');
    const layout=read('src/app/platform/layout.tsx');
    expect(component).toContain('/api/admin/platform/modular-quote-lab');
    expect(component).toContain('result.canCheckout!==false');
    expect(component).toContain('researchQuote.approvedForSale!==false');
    expect(component).toContain('المبلغ غير مستحق الدفع');
    expect(page).toContain('requirePlatformOperator()');
    expect(layout).toContain('/platform/modular-quote-lab');
    expect(component).not.toContain('/api/tenant/billing');
    expect(component).not.toContain('اعتماد الشراء');
  });
});

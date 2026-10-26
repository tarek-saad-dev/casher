import { describe, expect, it } from 'vitest';
import {
  calculateModularResearchQuote,
  compareModularResearchQuotes,
  minorToEgp,
  ModularQuoteError,
  type ModularResearchCatalog,
  type ModularResearchRules,
} from '@/platform/commercial/modularQuoteEngine';
import { calculateSalonResearchScenario } from '@/platform/commercial/modularPricingScenario';

const catalog: ModularResearchCatalog = {
  catalogId: 'salon-research-v1',
  version: 1,
  state: 'research_only',
  currency: 'EGP',
  industry: 'salon',
  monthlyPerAppMinor: { booking: 19900, pos: 29900, queue: 9900 },
  includedBranches: 1,
  baseMonthlyMinor: 0,
  extraBranchMonthlyMinor: 19900,
  maxBranches: 8,
  annualMonthsCharged: 10,
};
const rules: ModularResearchRules = {
  requiredApps: ['booking'],
  eligibleApps: ['booking', 'pos', 'queue'],
  dependencies: { booking: [], pos: [], queue: [] },
  labels: { booking: 'Booking', pos: 'POS', queue: 'Queue' },
};
const input = { industry:'salon', apps:['booking','pos'], branches:1, cycle:'monthly' as const };
const calc = (
  overrides: Partial<typeof input> = {},
  priceOverrides: Partial<ModularResearchCatalog> = {},
  ruleOverrides: Partial<ModularResearchRules> = {},
) => calculateModularResearchQuote(
  { ...input, ...overrides },
  { ...catalog, ...priceOverrides },
  { ...rules, ...ruleOverrides },
);
function errorCode(fn: () => unknown): string {
  try { fn(); } catch (error) { return error instanceof ModularQuoteError ? error.code : 'UNKNOWN_ERROR'; }
  return 'NO_ERROR';
}
describe('versioned pure modular research quote engine', () => {
  it('uses EGP minor units, itemized prices and no checkout/entitlement side effects', () => {
    expect(calc()).toMatchObject({
      kind:'internal_research_only',approvedForSale:false,canCheckout:false,canActivate:false,
      catalogId:'salon-research-v1',catalogVersion:1,totalMonthlyMinor:49800,totalPeriodMinor:49800,
      chargedMonths:1,
      lines:[{code:'booking',quantity:1,totalMonthlyMinor:19900},{code:'pos',quantity:1,totalMonthlyMinor:29900}],
    });
  });
  it('supports an explicit zero-priced research app but not a missing price', () => {
    const free=calc({}, {monthlyPerAppMinor:{...catalog.monthlyPerAppMinor,booking:0}});
    expect(free.lines.find(x=>x.code==='booking')?.totalMonthlyMinor).toBe(0);
    expect(errorCode(()=>calc({}, {monthlyPerAppMinor:{pos:29900,queue:9900}}))).toBe('CATALOG_INVALID');
  });
  it('supports zero or explicit base fee and keeps it separate from selected app prices', () => {
    const quoted=calc({}, {baseMonthlyMinor:14900});
    expect(quoted.lines[0]).toMatchObject({code:'platform-base',quantity:1,totalMonthlyMinor:14900});
    expect(quoted.totalMonthlyMinor).toBe(64700);
    expect(errorCode(()=>calc({}, {baseMonthlyMinor:-1}))).toBe('CATALOG_INVALID');
  });
  it('dedupes branch billing and uses configured annual months without floating money', () => {
    const q=calc({cycle:'annual',branches:3,apps:['booking','pos','queue']});
    expect(q.lines.find(x=>x.code==='extra-branch')).toMatchObject({quantity:2,unitMonthlyMinor:19900,totalMonthlyMinor:39800});
    expect(q.totalMonthlyMinor).toBe(99500);
    expect(q.totalPeriodMinor).toBe(995000);
    expect(minorToEgp(q.totalPeriodMinor)).toBe(9950);
  });
  it('rejects missing required apps, duplicate applications, unsupported app, invalid counts and cycles', () => {
    expect(errorCode(()=>calc({apps:['pos']}))).toBe('REQUIRED_APP_MISSING');
    expect(errorCode(()=>calc({apps:['booking','booking']}))).toBe('APPS_DUPLICATED');
    expect(errorCode(()=>calc({apps:['booking','ai-receptionist']}))).toBe('APP_NOT_PRICEABLE');
    expect(errorCode(()=>calc({branches:0}))).toBe('BRANCH_COUNT_INVALID');
    expect(errorCode(()=>calc({branches:9}))).toBe('BRANCH_COUNT_INVALID');
    expect(errorCode(()=>calc({cycle:'weekly' as 'monthly'}))).toBe('CYCLE_INVALID');
    expect(errorCode(()=>calc({industry:'supermarket'}))).toBe('INDUSTRY_UNSUPPORTED');
  });
  it('rejects incomplete dependencies instead of quietly billing a broken bundle', () => {
    expect(errorCode(()=>calc({}, {}, {
      dependencies:{booking:[],pos:['queue'],queue:[]},
    }))).toBe('MISSING_DEPENDENCY');
    expect(calc({apps:['booking','pos','queue']},{},{
      dependencies:{booking:[],pos:['queue'],queue:[]},
    }).lines).toHaveLength(3);
  });
  it('refuses catalog gaps, unauthorized codes, invalid rates, invalid state and overflowing totals', () => {
    expect(errorCode(()=>calc({}, {monthlyPerAppMinor:{booking:19900,pos:29900}}))).toBe('CATALOG_INVALID');
    expect(errorCode(()=>calc({}, {monthlyPerAppMinor:{...catalog.monthlyPerAppMinor,ai:100}}))).toBe('CATALOG_INVALID');
    expect(errorCode(()=>calc({}, {monthlyPerAppMinor:{booking:19900,pos:-1,queue:9900}}))).toBe('CATALOG_INVALID');
    expect(errorCode(()=>calc({}, {state:'approved' as 'research_only'}))).toBe('CATALOG_INVALID');
    expect(errorCode(()=>calc({}, {includedBranches:0}))).toBe('CATALOG_INVALID');
    expect(errorCode(()=>calc({}, {annualMonthsCharged:13}))).toBe('CATALOG_INVALID');
    expect(errorCode(()=>calc({branches:4},{extraBranchMonthlyMinor:Number.MAX_SAFE_INTEGER}))).toBe('AMOUNT_OVERFLOW');
    expect(errorCode(()=>calc({}, {version:0}))).toBe('CATALOG_INVALID');
  });
  it('provides an illustrative before/after difference but never prorates or changes a subscription', () => {
    const before=calc();
    const after=calc({apps:['booking','queue'],branches:2});
    const comparison=compareModularResearchQuotes(before,after);
    expect(comparison).toMatchObject({
      kind:'internal_research_comparison',canChangeSubscription:false,prorationCalculated:false,
      addedApps:['queue'],removedApps:['pos'],monthlyDifferenceMinor:-100,
      periodDifferenceMinor:-100,
    });
    expect(errorCode(()=>compareModularResearchQuotes(before,calc({cycle:'annual'})))).toBe('COMPARISON_INCOMPATIBLE');
    expect(errorCode(()=>compareModularResearchQuotes(before,calc({},{version:2})))).toBe('COMPARISON_INCOMPATIBLE');
  });
  it('compares two hypotheses through the server-selected catalog, not client supplied unit prices', () => {
    const basic=calculateSalonResearchScenario({
      industry:'salon',apps:['booking','pos','queue'],branches:1,cycle:'monthly',model:'per_app',
    });
    const alternative=calculateSalonResearchScenario({
      industry:'salon',apps:['booking','pos','queue'],branches:1,cycle:'monthly',model:'base_plus_apps',
    });
    expect(basic.monthlyEgp).toBe(597);
    // 149 EGP base + 80% of (199 + 299 + 99) EGP = 626.60 EGP
    expect(alternative.monthlyEgp).toBe(626.6);
    expect(alternative.model).toBe('base_plus_apps');
    expect(alternative.lines.some(x=>x.code==='platform-base')).toBe(true);
    expect(alternative.canCheckout).toBe(false);
  });
  it('preserves the existing operator research scenario output shape and arithmetic', () => {
    expect(calculateSalonResearchScenario({
      industry:'salon',apps:['booking','pos','queue'],branches:3,cycle:'annual',
    })).toMatchObject({
      version:'salon-modular-research-2026-10-26',catalogVersion:1,
      canCheckout:false,canActivate:false,monthlyEgp:995,illustrativePeriodEgp:9950,
      yearlyMonthsCharged:10,
    });
  });
});

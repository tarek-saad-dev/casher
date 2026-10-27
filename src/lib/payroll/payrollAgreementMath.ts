export type RetroBranch = { branchId: number; enabled: boolean; monthlySalary: number };
export type RetroInput = { effectiveFrom: string; branches: RetroBranch[]; reason: string; requestKey?: string; expectedFingerprint?: string };

const money=(n:number)=>Math.round(n*100)/100;
const dateRegex=/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function validateRetroInput(input:RetroInput):void {
  if(!input || typeof input.effectiveFrom!=='string' || !dateRegex.test(input.effectiveFrom) ||
      Number.isNaN(Date.parse(input.effectiveFrom)) ||
      new Date(input.effectiveFrom).toISOString().slice(0,10)!==input.effectiveFrom) {
    throw new Error('تاريخ الاتفاقية غير صالح');
  }
  if(!Array.isArray(input.branches)||!input.branches.length||
     !input.branches.some(b=>b.enabled)||
     new Set(input.branches.map(b=>b.branchId)).size!==input.branches.length||
     input.branches.some(b=>!Number.isSafeInteger(b.branchId)||b.branchId<1||
       typeof b.enabled!=='boolean'||(b.enabled &&
       (!Number.isFinite(b.monthlySalary)||b.monthlySalary<=0||
       b.monthlySalary>100000000||money(b.monthlySalary)!==b.monthlySalary)))) {
    throw new Error('حدد مرتبًا صحيحًا لكل فرع مفعل');
  }
  if(typeof input.reason!=='string'||input.reason.trim().length<8||input.reason.length>500) {
    throw new Error('سبب تعديل القبض مطلوب (8 أحرف على الأقل)');
  }
}

export function prorateSalary(effectiveFrom:string, salary:number) {
  const day=Number(effectiveFrom.slice(8,10));
  const monthDays=new Date(Date.UTC(
    Number(effectiveFrom.slice(0,4)),Number(effectiveFrom.slice(5,7)),0
  )).getUTCDate();
  const days=monthDays-day+1;
  return {days,monthDays,amount:money(salary*days/monthDays)};
}


/** Readable, branch-scoped financial impact. Does not calculate cash owed. */
export type RetroWageSource = { branchId: number; amount: number; ledgerAmount: number };
export type RetroBranchImpact = {
  branchId: number;
  dailyCount: number;
  oldWages: number;
  oldLedgerCredits: number;
  monthlySalary: number;
  newEntitlement: number;
  difference: number;
};
export function calculateRetroBranchImpacts(
  effectiveFrom: string,
  enabledBranches: RetroBranch[],
  dailyRows: RetroWageSource[],
): RetroBranchImpact[] {
  return enabledBranches.filter(b => b.enabled).map(b => {
    const source = dailyRows.filter(x => x.branchId === b.branchId);
    const oldWages = money(source.reduce((total, row) => total + row.amount, 0));
    const oldLedgerCredits = money(source.reduce((total, row) => total + row.ledgerAmount, 0));
    const newEntitlement = prorateSalary(effectiveFrom, b.monthlySalary).amount;
    return {
      branchId: b.branchId, dailyCount: source.length,
      oldWages, oldLedgerCredits,
      monthlySalary: b.monthlySalary, newEntitlement,
      difference: money(newEntitlement - oldLedgerCredits),
    };
  });
}

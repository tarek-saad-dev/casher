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

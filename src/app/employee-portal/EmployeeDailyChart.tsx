import type { EmpLedgerEntryRow } from '@/lib/types/employee-ledger';

const earningReasons = new Set(['hourly_wage','monthly_salary','target','commission','bonus']);
const money=(v:number)=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:0}).format(v)+' ج.م';
export default function EmployeeDailyChart({entries,month}:{entries:EmpLedgerEntryRow[];month:string}) {
 const [year,m]=month.split('-').map(Number);
 const grouped=new Map<string,{earnings:number;advances:number;posted:boolean}>();
 for(const e of entries){
  const key=e.entryDate.slice(0,10);
  if(!key.startsWith(month+'-'))continue;
  const row=grouped.get(key)??{earnings:0,advances:0,posted:false};
  if(e.entryDirection==='credit'&&earningReasons.has(e.entryReason)){row.earnings+=e.amount;row.posted=true;}
  if(e.entryDirection==='debit'&&e.entryReason==='advance')row.advances+=e.amount;
  grouped.set(key,row);
 }
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
 const today=`${parts.year}-${parts.month}-${parts.day}`;
 const count=new Date(Date.UTC(year,m,0)).getUTCDate();
 const days=Array.from({length:count},(_,i)=>{
  const date=`${month}-${String(i+1).padStart(2,'0')}`;
  return {date,num:i+1,...(grouped.get(date)??{earnings:0,advances:0,posted:false}),future:date>today};
 });
 const recorded=days.filter(d=>d.posted);
 const last=recorded.at(-1)?.date;
 const max=Math.max(1,...days.map(d=>Math.max(d.earnings,d.advances)));
 return <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 md:p-6">
  <div className="flex flex-wrap gap-3 items-start justify-between mb-5">
   <div><h2 className="text-xl font-bold">يومياتك والسلف</h2><p className="text-sm text-zinc-400 mt-1">المبالغ اللي اتسجلت لكل يوم من الشهر</p></div>
   <div className="bg-emerald-400/10 border border-emerald-400/30 rounded-xl px-4 py-3">
    <div className="text-xs text-zinc-300">آخر يوم اتسجلت له مستحقات</div><strong className="text-emerald-300 block mt-1">{last||'لسه مفيش يوميات مسجلة'}</strong>
   </div>
  </div>
  <div className="flex flex-wrap gap-4 text-xs mb-4">
   <span className="flex items-center gap-2"><i className="w-3 h-3 bg-emerald-400 rounded-sm"/>مستحقات مسجلة</span>
   <span className="flex items-center gap-2"><i className="w-3 h-3 bg-amber-400 rounded-sm"/>سلف</span>
   <span className="flex items-center gap-2"><i className="w-3 h-3 border border-dashed border-zinc-500 rounded-sm"/>لا يوجد تسجيل</span>
  </div>
  <div className="overflow-x-auto pb-2">
   <div className="flex items-end gap-2 h-48 min-w-[620px] border-b border-zinc-700">
    {days.map(d=><div key={d.date} className="flex-1 h-full flex flex-col justify-end items-center gap-1" title={`${d.date} | يوميات: ${money(d.earnings)} | سلف: ${money(d.advances)} | ${d.posted?'مسجل':'غير مسجل'}`}>
      <div className="w-full h-36 flex gap-[2px] items-end">
       <div className={`w-1/2 rounded-t ${d.posted?'bg-emerald-400':'border border-dashed border-zinc-600 bg-zinc-800'}`} style={{height:d.posted?`${Math.max(4,100*d.earnings/max)}%`:'4%'}}/>
       <div className="w-1/2 bg-amber-400 rounded-t" style={{height:d.advances?`${Math.max(4,100*d.advances/max)}%`:'0%'}}/>
      </div>
      <span className={`text-[10px] ${d.future?'text-zinc-600':'text-zinc-400'}`}>{d.num}</span>
     </div>)}
   </div>
  </div>
  <div className="grid grid-cols-2 gap-3 mt-5 text-sm">
   <div className="rounded-xl bg-zinc-950 p-3"><p className="text-xs text-zinc-400">أيام بها مستحقات مسجلة</p><strong>{recorded.length} يوم</strong></div>
   <div className="rounded-xl bg-zinc-950 p-3"><p className="text-xs text-zinc-400">أيام لا يوجد لها تسجيل حتى الآن</p><strong>{days.filter(d=>!d.future&&!d.posted).length} يوم</strong></div>
  </div>
  <p className="text-xs text-zinc-500 mt-4">غياب تسجيل يوم لا يعني غياب الموظف أو استحقاق يومية ناقصة. الرواتب الشهرية ممكن تتسجل دفعة واحدة. الأرقام حسب تاريخ القيد في دفتر الموظف.</p>
 </section>;
}

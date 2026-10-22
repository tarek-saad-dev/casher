import type { EmpLedgerEntryRow } from '@/lib/types/employee-ledger';
import type { PortalAttendance } from '@/lib/employee-portal/attendance';

const earningReasons = new Set(['hourly_wage','monthly_salary','target','commission','bonus','tip','employee_funding']);
const money=(n:number)=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:0}).format(n)+' ج.م';
export default function EmployeeDailyChart({entries,month,attendance=[]}:{entries:EmpLedgerEntryRow[];month:string;attendance?:PortalAttendance[]}) {
 const [year,m]=month.split('-').map(Number);
 const grouped=new Map<string,{earnings:number;advances:number;posted:boolean}>();
 for(const e of entries) {
  const key=e.entryDate.slice(0,10);
  if(!key.startsWith(month+'-'))continue;
  const row=grouped.get(key)??{earnings:0,advances:0,posted:false};
  if(e.entryDirection==='credit'&&earningReasons.has(e.entryReason)){row.earnings+=e.amount;row.posted=true;}
  if(e.entryDirection==='debit'&&e.entryReason==='advance')row.advances+=e.amount;
  grouped.set(key,row);
 }
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
 const today=`${parts.year}-${parts.month}-${parts.day}`;
 const attendedDays=new Set(attendance.filter(a=>a.checkIn!==null||a.checkOut!==null).map(a=>a.day));
 const count=new Date(Date.UTC(year,m,0)).getUTCDate();
 const days=Array.from({length:count},(_,i)=>{
  const date=`${month}-${String(i+1).padStart(2,'0')}`;
  return {date,num:i+1,...(grouped.get(date)??{earnings:0,advances:0,posted:false}),future:date>today,attended:attendedDays.has(date)};
 });
 const pending=days.filter(d=>d.date<today&&d.attended&&!d.posted);
 const max=Math.max(1,...days.map(d=>Math.max(d.earnings,d.advances)));
 return <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3 md:p-5" aria-label="يومياتك والسلف">
  <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
   <h2 className="text-lg font-bold text-white">يومياتك والسلف</h2>
   <div className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${pending.length?'border-amber-500/40 bg-amber-500/10 text-amber-300':'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>
    {pending.length?`${pending.length} يوم حضور بدون مستحقات مسجلة`:'لا توجد أيام حضور ناقصة القيد'}
   </div>
  </div>
  <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400">
   <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-emerald-400"/>المستحقات</span>
   <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-amber-400"/>السلف</span>
   <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm border border-dashed border-zinc-500"/>لم تُسجل مستحقات</span>
  </div>
  <div className="overflow-x-auto pb-1.5" aria-label="مقارنة المستحقات والسلف حسب اليوم">
   <div className="flex h-32 min-w-[560px] items-end gap-1.5 border-b border-zinc-700">
    {days.map(d=><div key={d.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${d.date} | مستحقات: ${money(d.earnings)} | سلف: ${money(d.advances)} | ${d.posted?'مستحقات مسجلة':d.attended?'حضور بدون قيد مستحقات':'لا يوجد قيد مستحقات'}`}>
     <div className="flex h-24 w-full items-end gap-px">
      <div className={`w-1/2 rounded-t-sm ${d.posted?'bg-emerald-400':d.attended&&!d.future?'border border-dashed border-amber-500/60 bg-amber-500/10':'bg-zinc-800'}`} style={{height:d.posted?`${Math.max(4,100*d.earnings/max)}%`:'3%'}}/>
      <div className="w-1/2 rounded-t-sm bg-amber-400" style={{height:d.advances?`${Math.max(4,100*d.advances/max)}%`:'0%'}}/>
     </div>
     <span className={`text-[10px] ${d.future?'text-zinc-600':'text-zinc-400'}`}>{d.num}</span>
    </div>)}
   </div>
  </div>
  {pending.length>0&&<p className="mt-2 text-xs text-zinc-400">الأيام دي فيها حضور مسجل، لكن مفيش قيد مستحقات يومي لسه. ده مش بالضرورة معناه نقص في الراتب؛ المستحق الشهري ممكن يتسجل دفعة واحدة.</p>}
 </section>;
}

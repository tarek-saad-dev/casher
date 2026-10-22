'use client';
import {useMemo,useState} from 'react';
import type {EmpLedgerEntryRow} from '@/lib/types/employee-ledger';
const money=(n:number)=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(n)+' ج.م';
const signed=(n:number)=>money(n);
type Props={month:string;today:string;entries:EmpLedgerEntryRow[]};
export default function DailyEfficiency({month,today,entries}:Props){
 const days=useMemo(()=>{const [y,m]=month.split('-').map(Number);const count=new Date(Date.UTC(y,m,0)).getUTCDate();return Array.from({length:count},(_,i)=>month+'-'+String(i+1).padStart(2,'0'));},[month]);
 const [selected,setSelected]=useState(()=>month===today.slice(0,7)?today:days[days.length-1]);
 const selectedDay=days.includes(selected)?selected:days[days.length-1];
 const index=days.indexOf(selectedDay);
 const daily=entries.filter(e=>e.entryDate===selectedDay);
 const total=(reasons:string[],dir:'credit'|'debit')=>daily.filter(e=>e.entryDirection===dir&&reasons.includes(e.entryReason)).reduce((s,e)=>s+e.amount,0);
 const salary=total(['hourly_wage','monthly_salary'],'credit');
 const target=total(['target','commission'],'credit');
 const tips=total(['tip','employee_funding'],'credit');
 const advances=total(['advance'],'debit');
 const deductions=total(['deduction','settlement','adjustment'],'debit');
 const net=salary+target+tips-advances-deductions;
 const details=[['الأساسي',salary,false],['التارجت',target,false],['إيراد أو Tips (المستحق للموظف)',tips,false],['سلف اليوم',advances,true],['خصومات اليوم',deductions,true]] as const;
 return <section className="space-y-5" aria-label="كفاءة اليوم">
  <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 md:p-6 space-y-4">
   <div className="flex items-center justify-between gap-2">
    <div><h2 className="font-bold text-lg">كفاءة اليوم</h2><p className="text-xs text-zinc-400">اختار يوم من الشهر للاطلاع على حركاته المعتمدة</p></div>
    <div className="flex gap-2">
     <button type="button" onClick={()=>setSelected(days[index-1])} disabled={index===0} className="rounded-lg border border-zinc-700 px-3 py-2 disabled:opacity-30" aria-label="اليوم السابق">›</button>
     <button type="button" onClick={()=>setSelected(days[index+1])} disabled={index===days.length-1} className="rounded-lg border border-zinc-700 px-3 py-2 disabled:opacity-30" aria-label="اليوم التالي">‹</button>
    </div>
   </div>
   <label className="block text-sm text-zinc-300">اليوم
    <select value={selectedDay} onChange={e=>setSelected(e.target.value)} className="mt-2 block w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-white">
     {days.map(day=><option key={day} value={day}>{new Intl.DateTimeFormat('ar-EG',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'))}</option>)}
    </select>
   </label>
  </div>
  <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
   <h3 className="font-bold">الحضور والانصراف</h3>
   <p className="text-sm text-zinc-400">الحضور، الانصراف، عدد ساعات العمل والتأخير: في انتظار ربط سجلات الحضور المعتمدة. مش بنحسبها من الفواتير أو حركة المرتب.</p>
  </div>
  <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
   <h3 className="font-bold">المستحقات اليومية</h3>
   {details.map(([label,amount,debit])=><div className="flex items-center justify-between gap-3" key={label}><span className="text-sm text-zinc-300">{label}</span><strong className={debit?'text-rose-400':'text-white'}>{debit?'−':'+'}{signed(amount)}</strong></div>)}
   <div className="border-t border-zinc-700 pt-4 flex items-center justify-between gap-3"><span className="font-bold">صافي اليوم</span><strong className="text-2xl text-amber-300">{money(net)}</strong></div>
   <p className="text-xs text-zinc-500">صافي الحركات اليومية المختارة، بدون حركة صرف المرتب. إيراد الخدمات للمحل لا يُضاف كدخل للموظف؛ المعروض فقط الاستحقاقات المسجلة في دفتره.</p>
   {daily.length===0?<p className="text-sm text-zinc-400">لا توجد حركات مالية معتمدة لليوم المحدد.</p>:<details className="border-t border-zinc-800 pt-3"><summary className="cursor-pointer text-sm text-amber-300">عرض {daily.length} حركة مسجلة</summary><div className="mt-3 space-y-2">{daily.map(e=><div key={e.id} className="text-sm flex justify-between gap-3"><span>{e.notes||e.entryReason}</span><span>{money(e.amount)}</span></div>)}</div></details>}
  </div>
 </section>;
}

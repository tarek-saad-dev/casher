'use client';
import {useMemo,useState} from 'react';
import type {EmpLedgerEntryRow} from '@/lib/types/employee-ledger';
import type {PortalAttendance} from '@/lib/employee-portal/attendance';

const money=(n:number)=>new Intl.NumberFormat('ar-EG',{maximumFractionDigits:2}).format(n)+' ج.م';
type Props={month:string;today:string;entries:EmpLedgerEntryRow[];attendance:PortalAttendance[]};
type Group={label:string;amount:number;reasons:string[]};

export default function DailyEfficiency({month,today,entries,attendance}:Props){
 const days=useMemo(()=>{const [y,m]=month.split('-').map(Number);return Array.from({length:new Date(Date.UTC(y,m,0)).getUTCDate()},(_,i)=>month+'-'+String(i+1).padStart(2,'0'));},[month]);
 const [selected,setSelected]=useState(()=>month===today.slice(0,7)?today:days[days.length-1]);
 const selectedDay=days.includes(selected)?selected:days[days.length-1];
 const index=days.indexOf(selectedDay);
 const daily=entries.filter(e=>e.entryDate===selectedDay);
 const attendanceToday=attendance.filter(a=>a.day===selectedDay);
 const dateLabel=new Intl.DateTimeFormat('ar-EG',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(selectedDay+'T12:00:00Z'));
 const total=(reasons:string[],dir:'credit'|'debit')=>daily.filter(e=>e.entryDirection===dir&&reasons.includes(e.entryReason)).reduce((s,e)=>s+e.amount,0);
 const salary=total(['hourly_wage','monthly_salary'],'credit');
 const target=total(['target','commission'],'credit');
 const tips=total(['tip','employee_funding'],'credit');
 const advances=total(['advance'],'debit');
 const deductions=total(['deduction','settlement','adjustment'],'debit');
 const income=salary+target+tips,outgo=advances+deductions,net=income-outgo;
 const incomeGroups:Group[]=[{label:'الأساسي',amount:salary,reasons:['hourly_wage','monthly_salary']},{label:'التارجت',amount:target,reasons:['target','commission']},{label:'إيراد / Tips',amount:tips,reasons:['tip','employee_funding']}];
 const expenseGroups:Group[]=[{label:'السلف',amount:advances,reasons:['advance']},{label:'الخصومات',amount:deductions,reasons:['deduction','settlement','adjustment']}];
 const worked=attendanceToday.length>0&&attendanceToday.every(a=>a.workedMinutes!==null)
  ?attendanceToday.reduce((sum,a)=>sum+(a.workedMinutes||0),0):null;
 const entriesFor=(g:Group,dir:'credit'|'debit')=>daily.filter(e=>e.entryDirection===dir&&g.reasons.includes(e.entryReason));
 const groupUI=(g:Group,dir:'credit'|'debit')=>{
  const rows=entriesFor(g,dir);
  return <details key={g.label} className="group border-t border-zinc-800 first:border-t-0">
   <summary className="flex cursor-pointer list-none items-center justify-between gap-1.5 py-2.5 text-xs sm:text-sm [&::-webkit-details-marker]:hidden">
    <span className="flex min-w-0 items-center gap-1 font-medium text-zinc-200">
     <span className={`inline-block text-zinc-500 transition-transform group-open:rotate-90 ${rows.length===0?'opacity-30':''}`} aria-hidden="true">‹</span>
     <span>{g.label}</span>
    </span>
    <strong dir="ltr" className={`shrink-0 text-xs sm:text-sm ${dir==='credit'?'text-emerald-300':'text-rose-300'}`}>{dir==='credit'?'+':'−'}{money(g.amount)}</strong>
   </summary>
   <div className="space-y-2 border-t border-zinc-800/70 pb-3 pt-2">
    {rows.length?rows.map(e=><div key={e.id} className="space-y-0.5 text-xs text-zinc-400">
     <p className="break-words">{e.notes||e.entryReason}{e.branchName?' · '+e.branchName:''}</p>
     <p className="font-medium text-zinc-300">{money(e.amount)}</p>
    </div>):<p className="text-xs text-zinc-500">لا توجد حركات</p>}
   </div>
  </details>;
 };
 return <section aria-label="كفاءة اليوم" className="space-y-2.5 border-t border-zinc-700 pt-3">
  <h2 className="text-xl font-extrabold text-white">كفاءة اليوم</h2>
  <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-2.5">
   <div dir="rtl" className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2">
    <button type="button" onClick={()=>setSelected(days[index-1])} disabled={index===0} aria-label="اليوم السابق" title="اليوم السابق" className="flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-950 text-2xl font-bold text-white disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-amber-400">‹</button>
    <label className="relative flex min-w-0 items-center justify-center">
     <span className="sr-only">اختيار يوم من الشهر</span>
     <span className="pointer-events-none truncate text-center text-sm font-semibold text-white">{dateLabel} <span className="text-amber-400">⌄</span></span>
     <select value={selectedDay} onChange={e=>setSelected(e.target.value)} aria-label="اختيار يوم من الشهر" className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
      {days.map(day=><option key={day} value={day}>{new Intl.DateTimeFormat('ar-EG',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'))}</option>)}
     </select>
    </label>
    <button type="button" onClick={()=>setSelected(days[index+1])} disabled={index===days.length-1} aria-label="اليوم التالي" title="اليوم التالي" className="flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-950 text-2xl font-bold text-white disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-amber-400">›</button>
   </div>
  </div>
  <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3">
   <div className="grid grid-cols-3 gap-2 text-center">
    {[{label:'الحضور',value:attendanceToday.map(a=>a.checkIn||'—').join('، ')||'—'},{label:'الانصراف',value:attendanceToday.map(a=>a.checkOut||'—').join('، ')||'—'},{label:'ساعات العمل',value:worked!==null?`${Math.floor(worked/60)} س ${worked%60} د`:'—'}].map(item=><div className="min-w-0" key={item.label}>
     <p className="text-xs text-zinc-400">{item.label}</p>
     <p className="mt-1 break-words text-sm font-bold text-white" dir="auto">{item.value}</p>
    </div>)}
   </div>
   {attendanceToday.length>0&&<p className="mt-2 truncate border-t border-zinc-800 pt-2 text-center text-xs text-zinc-500">{[...new Set(attendanceToday.map(a=>a.branch).filter(Boolean))].join(' · ')}</p>}
  </div>
  <div className="grid grid-cols-2 gap-2">
   <div className="min-w-0 rounded-xl border border-emerald-800/40 bg-zinc-900 p-2.5">
    <div className="mb-1 flex items-center justify-between gap-1"><h3 className="text-sm font-bold text-emerald-300">الدخل</h3><strong className="text-xs text-emerald-300">{money(income)}</strong></div>
    {incomeGroups.map(g=>groupUI(g,'credit'))}
   </div>
   <div className="min-w-0 rounded-xl border border-rose-800/40 bg-zinc-900 p-2.5">
    <div className="mb-1 flex items-center justify-between gap-1"><h3 className="text-sm font-bold text-rose-300">المسحوبات</h3><strong className="text-xs text-rose-300">{money(outgo)}</strong></div>
    {expenseGroups.map(g=>groupUI(g,'debit'))}
   </div>
  </div>
  <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
   <span className="font-bold text-amber-200">صافي اليوم</span>
   <strong className="text-2xl font-extrabold text-white">{money(net)}</strong>
  </div>
 </section>;
}

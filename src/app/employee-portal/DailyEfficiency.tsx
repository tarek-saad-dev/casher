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
 const incomeGroups=[
  {label:'الأساسي',amount:salary,reasons:['hourly_wage','monthly_salary']},
  {label:'التارجت',amount:target,reasons:['target','commission']},
  {label:'إيراد / Tips',amount:tips,reasons:['tip','employee_funding']},
 ];
 const expenseGroups=[
  {label:'السلف',amount:advances,reasons:['advance']},
  {label:'الخصومات',amount:deductions,reasons:['deduction','settlement','adjustment']},
 ];
 const renderGroup=(group:{label:string;amount:number;reasons:string[]},dir:'credit'|'debit')=>{
  const rows=daily.filter(e=>e.entryDirection===dir&&group.reasons.includes(e.entryReason));
  return <div key={group.label} className="border-b border-zinc-800 pb-3 last:border-0 last:pb-0">
   <div className="flex items-center justify-between gap-2 text-sm"><span className="font-semibold text-zinc-200">{group.label}</span><strong className={dir==='credit'?'text-emerald-300':'text-rose-300'}>{dir==='credit'?'+':'−'}{money(group.amount)}</strong></div>
   {rows.length>0&&<div className="mt-2 space-y-1.5">{rows.map(e=><div key={e.id} className="flex items-start justify-between gap-3 text-xs text-zinc-400"><span className="break-words">{e.notes||e.entryReason}{e.branchName?' · '+e.branchName:''}</span><span className="shrink-0">{money(e.amount)}</span></div>)}</div>}
  </div>;
 };
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
  <div className="grid grid-cols-2 gap-3">
   <section className="rounded-2xl border border-emerald-700/30 bg-zinc-900 p-3 md:p-5 space-y-4 min-w-0">
    <div className="space-y-1"><h3 className="font-bold text-emerald-300">الدخل اليوم</h3><p className="text-xs text-zinc-400">الاستحقاقات</p></div>
    {incomeGroups.map(g=>renderGroup(g,'credit'))}
    <div className="flex justify-between gap-1 text-sm border-t border-zinc-700 pt-3"><span>الإجمالي</span><strong className="text-emerald-300">{money(salary+target+tips)}</strong></div>
   </section>
   <section className="rounded-2xl border border-rose-700/30 bg-zinc-900 p-3 md:p-5 space-y-4 min-w-0">
    <div className="space-y-1"><h3 className="font-bold text-rose-300">المسحوبات اليوم</h3><p className="text-xs text-zinc-400">السلف والخصومات</p></div>
    {expenseGroups.map(g=>renderGroup(g,'debit'))}
    <div className="flex justify-between gap-1 text-sm border-t border-zinc-700 pt-3"><span>الإجمالي</span><strong className="text-rose-300">{money(advances+deductions)}</strong></div>
   </section>
  </div>
  <div className="rounded-3xl border border-amber-500/40 bg-amber-500/10 p-5 md:p-7 space-y-2">
   <p className="text-sm text-amber-300">صافي اليوم</p>
   <p className="text-3xl md:text-4xl font-extrabold">{money(net)}</p>
   <p className="text-xs text-zinc-400">الأساسي + التارجت + الإيراد المستحق / Tips − السلف − الخصومات. لا يشمل الصرف النهائي للراتب.</p>
   {daily.length===0&&<p className="text-sm text-zinc-400">لا توجد حركات مسجلة لهذا اليوم.</p>}
  </div>
  <p className="text-xs text-zinc-500">جميع التفاصيل من دفتر الموظف المعتمد. إيراد خدمات المحل لا يُضاف لمستحقات الموظف تلقائيًا.</p>
 </section>;
}

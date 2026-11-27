'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import type {PublicationAdminRow} from '@/lib/cut-club/membershipPublication';
const endpoint='/api/admin/cut-club/membership-publication';
const statuses={DRAFT:'مسودة',PUBLISHED:'منشور تجريبيًا',UPDATE_PENDING:'نسخة جديدة غير منشورة',WITHDRAWN:'تم إيقاف النشر'};
export default function MembershipPublicationPage(){
 const [rows,setRows]=useState<PublicationAdminRow[]>([]),[code,setCode]=useState(''),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const current=rows.find(r=>r.code===code);
 const load=async()=>{setReady(false);setRows([]);setCode('');setConfirmed(false);setReason('');try{const r=await fetch(endpoint,{cache:'no-store',credentials:'same-origin'});const d=await r.json();if(!r.ok||d.trialOnly!==true)throw Error('UNAVAILABLE');setRows(d.items);setReady(true);}catch{setError('النشر التجريبي غير متاح. راجع إعدادات بيئة الاختبار.');}};
 useEffect(()=>{void load();},[]);
 async function save(action:'PUBLISH'|'WITHDRAW'){if(!current||!confirmed||reason.trim().length<5||busy)return;
 setBusy(true);setNotice('');setError('');
 try{const r=await fetch(endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,code:current.code,expectedRevision:current.publicationRevision,programRevision:action==='PUBLISH'?current.programRevision:current.publishedProgramRevision,reason})});
 const d=await r.json();if(!r.ok||d.trialOnly!==true)throw Error(d.code);
 setNotice(action==='PUBLISH'?'تم نشر النسخة في بيئة الاختبار.':'تم إيقاف عرض النسخة في بيئة الاختبار.');await load();
 }catch{setError('تعذر تأكيد القرار. حدّث القائمة وراجع النسخة قبل إعادة المحاولة.');setReady(false);}finally{setBusy(false);}}
 return <main dir="rtl" className="min-h-screen bg-[#0a0a0a] p-4 text-white sm:p-8"><div className="mx-auto max-w-5xl space-y-5">
 <Link href="/admin/cut-club/membership-drafts" className="text-sm text-yellow-400">← إعداد المسودات</Link><h1 className="text-3xl font-black">نشر برامج العضويات</h1><p className="text-sm text-zinc-400">بيئة اختبار فقط؛ النشر يعرض النسخة المختارة ولا يتيح الانضمام أو أي مزايا مالية.</p>
 <button disabled={busy} type="button" onClick={()=>{setError('');void load();}} className="rounded-xl border border-zinc-700 px-4 py-2">تحديث</button>
 {error&&<p role="alert" className="text-red-300">{error}</p>}{notice&&<p role="status" className="text-green-300">{notice}</p>}
 {ready&&!rows.length&&<p>لا توجد برامج محفوظة.</p>}
 <div className="grid gap-3 sm:grid-cols-2">{rows.map(x=><button key={x.code} disabled={busy||!ready} onClick={()=>{setCode(x.code);setReason('');setConfirmed(false);}} className={'rounded-xl border p-4 text-right '+(code===x.code?'border-yellow-400':'border-zinc-800')}><b>{x.title}</b><p className="text-sm text-zinc-400">{statuses[x.status]} · مسودة {x.programRevision} · نشر {x.publishedProgramRevision??'—'}</p></button>)}</div>
 {current&&ready&&<section className="space-y-4 rounded-xl border border-zinc-800 p-5"><h2 className="font-bold">{current.title}</h2>
 <label className="block">سبب القرار<textarea disabled={busy} className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 p-3" maxLength={300} value={reason} onChange={e=>setReason(e.target.value)}/></label>
 <label className="flex gap-3"><input disabled={busy} type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>أؤكد مراجعة النسخة والقرار، دون تفعيل خصم أو عضوية.</label>
 <div className="flex flex-wrap gap-3"><button type="button" disabled={busy||!confirmed||reason.trim().length<5||current.status==='PUBLISHED'} onClick={()=>void save('PUBLISH')} className="rounded-xl bg-yellow-400 px-5 py-3 font-bold text-black disabled:opacity-50">نشر أحدث نسخة تجريبيًا</button><button type="button" disabled={busy||!confirmed||reason.trim().length<5||current.publishedProgramRevision===null} onClick={()=>void save('WITHDRAW')} className="rounded-xl border border-red-500/40 px-5 py-3 text-red-300 disabled:opacity-50">إيقاف عرض البرنامج</button></div></section>}
 </div></main>;
}

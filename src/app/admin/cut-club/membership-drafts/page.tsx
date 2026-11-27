'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import type {DraftInput,DraftRow} from '@/lib/cut-club/membershipDraft';
const api='/api/admin/cut-club/membership-drafts';
const empty:DraftInput={code:'',expectedRevision:0,title:'',kind:'GENERAL',minimumVisits:0,allowedBranchIds:[],partnerCode:null,reason:''};
const cls='mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-white';
const names={GENERAL:'عامة',STUDENT:'طلاب',DOCTOR:'أطباء',COMPANY:'شركات'};
export default function MembershipDraftsPage(){
 const [items,setItems]=useState<DraftRow[]>([]),[form,setForm]=useState<DraftInput>(empty);
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const patch=(v:Partial<DraftInput>)=>setForm(x=>({...x,...v}));
 const load=async()=>{setReady(false);setError('');setItems([]);try{const r=await fetch(api,{cache:'no-store',credentials:'same-origin'});const d=await r.json();if(!r.ok||d.draftOnly!==true)throw Error('unavailable');setItems(d.items);setReady(true);}catch{setError('حفظ المسودات غير متاح إلا في بيئة الاختبار المعتمدة.');}};
 useEffect(()=>{void load();},[]);
 const edit=(x:DraftRow)=>setForm({code:x.code,expectedRevision:x.revision,title:x.title,kind:x.kind,minimumVisits:x.minimumVisits,allowedBranchIds:x.allowedBranchIds,partnerCode:x.partnerCode,reason:''});
 async function save(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');setNotice('');
 try{const r=await fetch(api,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)});const d=await r.json();
 if(!r.ok||d.draftOnly!==true){if(d.code==='REVISION_CONFLICT'){await load();throw Error('تم تعديل البرنامج من مكان آخر. اختر النسخة الأحدث وأعد المحاولة.');}throw Error('تعذر حفظ المسودة. راجع الحقول والصلاحيات.');}
 edit(d.item);setNotice('تم حفظ نسخة رقم '+d.item.revision+' كمسودة فقط.');await load();
 }catch(e){setError(e instanceof Error?e.message:'تعذر الحفظ');}finally{setBusy(false);}}
 return <main dir="rtl" className="min-h-screen bg-[#0a0a0a] p-4 text-white sm:p-8"><div className="mx-auto max-w-5xl space-y-6">
 <Link href="/admin/cut-club/membership-preview" className="text-sm text-yellow-400">معاينة الاستحقاق ←</Link>
 <h1 className="text-3xl font-black">مسودات برامج العضويات</h1><p className="text-sm text-zinc-400">إعداد وحفظ نسخ القواعد للمراجعة فقط. لا نشر أو منح عضوية أو خصم.</p>
 {error&&<p role="alert" className="rounded-xl border border-red-500/30 p-4 text-red-300">{error}</p>}
 {notice&&<p role="status" className="text-green-300">{notice}</p>}
 <div className="grid gap-5 lg:grid-cols-[1fr_1.5fr]">
 <section className="space-y-3 rounded-2xl border border-zinc-800 p-5"><div className="flex justify-between"><h2 className="font-bold">البرامج المحفوظة</h2><button type="button" onClick={()=>void load()} disabled={busy}>تحديث</button></div>
 {ready&&<button type="button" disabled={busy} onClick={()=>{setForm(empty);setNotice('');}} className="text-yellow-400">+ برنامج جديد</button>}
 {ready&&!items.length&&<p className="text-zinc-500">لا توجد مسودات محفوظة.</p>}
 {items.map(x=><button type="button" disabled={busy} key={x.code} onClick={()=>edit(x)} className="block w-full rounded-xl border border-zinc-700 p-4 text-right"><span className="font-bold">{x.title}</span><span className="block text-xs text-zinc-400">{x.code} · نسخة {x.revision} · {names[x.kind]}</span></button>)}
 </section>
 <form onSubmit={save} className="space-y-4 rounded-2xl border border-zinc-800 p-5"><fieldset disabled={!ready||busy} className="space-y-4">
 <legend className="font-bold">{form.expectedRevision?'تعديل مسودة — نسخة '+form.expectedRevision:'برنامج جديد'}</legend>
 <label className="block">كود البرنامج<input className={cls} required disabled={form.expectedRevision>0} maxLength={40} pattern="[A-Z0-9_\-]+" value={form.code} onChange={e=>patch({code:e.target.value.toUpperCase()})}/></label>
 <label className="block">اسم البرنامج<input className={cls} required maxLength={100} value={form.title} onChange={e=>patch({title:e.target.value})}/></label>
 <label className="block">الفئة<select className={cls} value={form.kind} onChange={e=>patch({kind:e.target.value as DraftInput['kind'],partnerCode:null})}>{Object.entries(names).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
 <label className="block">الحد الأدنى للزيارات<input className={cls} type="number" required min={0} max={100000} value={form.minimumVisits} onChange={e=>patch({minimumVisits:Number(e.target.value)})}/></label>
 <div className="space-y-2"><p>الفروع</p>{[[1,'جليم'],[3,'كامب شيزار']].map(([id,label])=><label key={id} className="flex gap-3"><input type="checkbox" checked={form.allowedBranchIds.includes(Number(id))} onChange={e=>patch({allowedBranchIds:e.target.checked?[...form.allowedBranchIds,Number(id)]:form.allowedBranchIds.filter(n=>n!==Number(id))})}/>{label}</label>)}</div>
 {form.kind!=='GENERAL'&&<label className="block">كود الجهة (اختياري)<input className={cls} maxLength={40} value={form.partnerCode??''} onChange={e=>patch({partnerCode:e.target.value.toUpperCase()||null})}/></label>}
 <label className="block">سبب الحفظ / التعديل<textarea className={cls} required minLength={5} maxLength={300} value={form.reason} onChange={e=>patch({reason:e.target.value})}/></label>
 <button disabled={!ready||busy||!form.allowedBranchIds.length} className="rounded-xl bg-yellow-400 px-5 py-3 font-bold text-black disabled:opacity-50">{busy?'جاري الحفظ…':'حفظ نسخة مسودة'}</button>
 </fieldset></form></div></div></main>;
}

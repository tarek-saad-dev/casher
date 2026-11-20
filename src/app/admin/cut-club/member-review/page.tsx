'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Clock3, Link2, LockKeyhole,
  RefreshCw, Search, ShieldCheck, ShieldOff, UserRoundCheck, Users,
} from 'lucide-react';

type Member={
  accountId:string;phoneMasked:string;clientName:string|null;
  linkStatus:'ACTIVE'|'UNLINKED'|'REVIEW_REQUIRED';
  accessStatus:'ENABLED'|'SUSPENDED';createdAt:string;
};
type Candidate={clientId:number;name:string|null;visits:number|null;hasLoyalty:boolean;linkedElsewhere:boolean};
type Tab='all'|'review'|'active'|'suspended';
const panel='rounded-2xl border border-white/10 bg-[#18191e] shadow-[0_12px_38px_rgba(0,0,0,.14)]';
const field='w-full min-h-11 rounded-xl border border-white/15 bg-[#101116] px-4 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-amber-400/60';
const button='inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40';
const dateLabel=(raw:string)=>{const d=new Date(raw);return Number.isFinite(d.getTime())?d.toLocaleDateString('ar-EG'):'';};
function StateTag({m}:{m:Member}){
  if(m.accessStatus==='SUSPENDED')return <span className="rounded-full border border-rose-500/25 bg-rose-500/10 px-3 py-1 text-xs font-bold text-rose-300">موقوف</span>;
  if(m.linkStatus==='ACTIVE')return <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-300">نشط</span>;
  if(m.linkStatus==='REVIEW_REQUIRED')return <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-300">تحت المراجعة</span>;
  return <span className="rounded-full border border-sky-500/25 bg-sky-500/10 px-3 py-1 text-xs font-bold text-sky-300">عضو جديد</span>;
}
export default function CutClubMemberReviewPage(){
  const [items,setItems]=useState<Member[]>([]);
  const [stats,setStats]=useState<{all:number;active:number;review:number;suspended:number}|null>(null);
  const [serverPhone,setServerPhone]=useState<string|null>(null);
  const [selected,setSelected]=useState('');
  const [tab,setTab]=useState<Tab>('all');
  const [search,setSearch]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [candidates,setCandidates]=useState<Candidate[]|null>(null);
  const [candidateLoading,setCandidateLoading]=useState(false);
  const [clientId,setClientId]=useState('');
  const [manual,setManual]=useState(false);
  const [proof,setProof]=useState(false);
  const [reason,setReason]=useState('');

  const reload=useCallback(async(phone?:string)=>{
    setLoading(true);setError('');
    try{
      const url='/api/admin/cut-club/member-link'+(phone?'?phone='+encodeURIComponent(phone):'');
      const res=await fetch(url,{cache:'no-store',credentials:'same-origin'});
      const data=await res.json();
      if(!res.ok||!data.ok)throw new Error(data?.code||'CUT_CLUB_UNAVAILABLE');
      setItems(data.items||[]);
      setStats(data.stats||null);
    }catch{setError('تعذر تحميل العضويات. تحقق من صلاحيات الإدارة واتصال Casher.');}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void reload();},[reload]);
  const current=items.find(a=>a.accountId===selected)||null;
  const counts=useMemo(()=>stats||({
    all:items.length,
    active:items.filter(a=>a.accessStatus==='ENABLED'&&a.linkStatus==='ACTIVE').length,
    review:items.filter(a=>a.accessStatus==='ENABLED'&&a.linkStatus!=='ACTIVE').length,
    suspended:items.filter(a=>a.accessStatus==='SUSPENDED').length,
  }),[items,stats]);
  const filtered=useMemo(()=>items.filter(a=>{
    if(tab==='active'&&(a.accessStatus!=='ENABLED'||a.linkStatus!=='ACTIVE'))return false;
    if(tab==='review'&&(a.accessStatus!=='ENABLED'||a.linkStatus==='ACTIVE'))return false;
    if(tab==='suspended'&&a.accessStatus!=='SUSPENDED')return false;
    const q=search.trim().toLowerCase();
    return !q||(serverPhone===search.trim())||a.phoneMasked.includes(q)||Boolean(a.clientName?.toLowerCase().includes(q));
  }),[items,tab,search,serverPhone]);

  const choose=async(a:Member)=>{
    setSelected(a.accountId);setError('');setNotice('');setProof(false);setReason('');
    setClientId('');setCandidates(null);setManual(false);
    if(a.linkStatus==='ACTIVE'||a.accessStatus==='SUSPENDED')return;
    setCandidateLoading(true);
    try{
      const r=await fetch('/api/admin/cut-club/member-link/candidates?accountId='+encodeURIComponent(a.accountId),{
        cache:'no-store',credentials:'same-origin',
      });
      const d=await r.json();
      if(!r.ok||!d.ok)throw Error(d.code||'DENIED');
      setCandidates(d.items||[]);
    }catch{setError('تعذر تحميل السجلات المطابقة. لا تربط حسابًا قبل التحقق من ملكيته.');setCandidates(null);}
    finally{setCandidateLoading(false);}
  };
  const approve=async(e:FormEvent)=>{
    e.preventDefault();
    const id=Number(clientId);
    if(!current||current.accessStatus==='SUSPENDED'||current.linkStatus==='ACTIVE'||!proof||
       !Number.isSafeInteger(id)||id<1)return;
    setBusy(true);setError('');setNotice('');
    try{
      const r=await fetch('/api/admin/cut-club/member-link',{
        method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({accountId:current.accountId,clientId:id,proofType:'IN_PERSON_ID',confirmedInPerson:true}),
      });
      const d=await r.json();
      if(!r.ok||!d.ok)throw Error(d.code||'DENIED');
      setNotice('تم ربط العضوية بعد التحقق من الهوية. المحفظة جاهزة للعضو.');
      setSelected('');await reload(serverPhone||undefined);
    }catch(e){
      setError(e instanceof Error&&e.message==='CLIENT_ALREADY_LINKED'
        ?'سجل العميل مربوط بعضوية أخرى، يجب مراجعة التعارض.'
        :'الربط لم يكتمل. راجع هوية العميل ورقم الموبايل والسجل المختار.');
    }finally{setBusy(false);}
  };
  const moderate=async(action:'SUSPEND'|'RESUME')=>{
    if(!current||reason.trim().length<5||busy)return;
    if(action==='SUSPEND'&&!window.confirm('تأكيد إيقاف CUT CLUB لهذا العضو؟ لن تظهر له المحفظة حتى إعادة التفعيل.'))return;
    setBusy(true);setError('');setNotice('');
    try{
      const r=await fetch('/api/admin/cut-club/member-account',{
        method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({accountId:current.accountId,action,reason:reason.trim()}),
      });
      const d=await r.json();
      if(!r.ok||!d.ok)throw Error(d.code||'DENIED');
      setNotice(action==='SUSPEND'?'تم إيقاف العضوية. العميل هيشوف حالة المراجعة بدون محفظة.':'تم إعادة تفعيل العضوية.');
      setReason('');await reload(serverPhone||undefined);
    }catch{setError('تعذر تحديث حالة العضوية. راجع الصلاحيات وحاول مرة أخرى.');}
    finally{setBusy(false);}
  };

  return <main dir="rtl" lang="ar" className="min-h-screen bg-[#090a0e] px-4 py-7 text-[#f8f6f0] sm:px-6 xl:px-10">
    <div className="mx-auto max-w-[1500px] space-y-6">
      <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div className="space-y-2">
          <p className="text-xs font-black tracking-[.18em] text-[#e3b978]" dir="ltr">CUT CLUB / MEMBER CONTROL</p>
          <h1 className="text-2xl font-black sm:text-3xl">إدارة عضويات CUT CLUB</h1>
          <p className="max-w-2xl text-sm leading-7 text-zinc-400">راجع الحالات الاستثنائية، اربط السجلات القديمة بعد التحقق من الهوية، أو أوقف حساب عضو بدون المساس بنقاطه.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/admin/cut-club/member-support" className={button+' border border-white/15 text-zinc-200 hover:bg-white/5'}>دعم الأعضاء <ArrowLeft size={15}/></a>
          <button type="button" onClick={()=>void reload()} disabled={loading} className={button+' border border-white/15 bg-[#1b1b20] text-white hover:bg-white/10'}>
            <RefreshCw size={16} className={loading?'animate-spin':''}/> تحديث
          </button>
        </div>
      </header>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="ملخص حالات العضوية">
        {([
          {id:'all' as Tab,label:'إجمالي الأعضاء',value:counts.all,icon:Users,color:'text-[#e9c99f]'},
          {id:'active' as Tab,label:'نشط',value:counts.active,icon:UserRoundCheck,color:'text-emerald-300'},
          {id:'review' as Tab,label:'تحتاج متابعة',value:counts.review,icon:Clock3,color:'text-amber-300'},
          {id:'suspended' as Tab,label:'موقوف',value:counts.suspended,icon:ShieldOff,color:'text-rose-300'},
        ]).map(t=><button key={t.id} type="button" onClick={()=>setTab(t.id)}
          className={panel+' flex items-center justify-between gap-2 p-4 text-right transition hover:border-[#bc956e]/40 '+(tab===t.id?'!border-[#dfb78c]/60 bg-[#24201e]':'')}>
          <div><p className="text-xs text-zinc-400">{t.label}</p><p className="mt-2 text-2xl font-black tabular-nums">{t.value}</p></div>
          <t.icon className={t.color} size={22}/>
        </button>)}
      </section>
      {error&&<div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-500/25 bg-rose-950/30 px-4 py-3 text-sm text-rose-200"><AlertTriangle size={17}/>{error}</div>}
      {notice&&<div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200"><CheckCircle2 size={18}/>{notice}</div>}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(350px,1fr)]">
        <section className={panel+' overflow-hidden'}>
          <div className="border-b border-white/10 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold">الأعضاء <span className="text-xs font-normal text-zinc-500">(أحدث 200 حساب)</span></h2>
              <span className="text-xs text-zinc-400">{filtered.length} نتيجة</span>
            </div>
            <label className="relative mt-4 block">
              <Search size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500"/>
              <input aria-label="بحث عن عضو" className={field+' pr-11'} value={search} onChange={e=>{
                setSearch(e.target.value);
                if(serverPhone){setServerPhone(null);void reload();}
              }} placeholder="بحث بالاسم أو رقم الموبايل"/>
            </label>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] leading-5 text-zinc-500">بحث الاسم في آخر 200 حساب، أو أدخل رقم كامل للبحث في كل الأعضاء.</p>
              <button type="button" className={button+' border border-[#e2bb94]/40 text-[#e9c9a9] hover:bg-white/5'}
                onClick={()=>{
                  if(!/^(?:01[0125]\\d{8}|(?:\\+?20|0020)1[0125]\\d{8})$/.test(search.trim())){
                    setError('اكتب رقم موبايل مصري كامل علشان نبحث في كل الحسابات.');return;
                  }
                  setError('');setServerPhone(search.trim());void reload(search.trim());
                }}>
                <Search size={15}/> بحث بالرقم في كل الحسابات
              </button>
            </div>
          </div>
          {loading?<div className="p-8 text-center text-zinc-400">جاري تحميل العضويات…</div>
            :filtered.length===0?<div className="px-5 py-14 text-center text-sm text-zinc-400">مفيش حسابات مطابقة للبحث أو الفلتر.</div>
            :<div className="max-h-[650px] overflow-y-auto divide-y divide-white/[.07]">
              {filtered.map(a=><button key={a.accountId} type="button" onClick={()=>void choose(a)}
                className={'flex w-full items-center gap-3 px-4 py-4 text-right transition hover:bg-white/[.05] sm:px-5 '+(selected===a.accountId?'bg-[#403024]/40':'')}>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#3a2a29] text-[#e6c2a1]"><Users size={19}/></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{a.clientName||'عضو CUT CLUB'}</p>
                  <p dir="ltr" className="mt-1 text-right text-xs tabular-nums text-zinc-400">{a.phoneMasked}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2"><StateTag m={a}/><span className="text-[11px] text-zinc-500">{dateLabel(a.createdAt)}</span></div>
              </button>)}
            </div>}
        </section>
        <section className={panel+' p-5 sm:p-6'}>
          {!current?<div className="py-14 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[#e0b990]/20 bg-[#e0b990]/10"><ShieldCheck className="text-[#e7c5a2]"/></div>
            <h2 className="mt-5 text-lg font-black">اختار عضو من القائمة</h2>
            <p className="mt-2 text-sm leading-7 text-zinc-400">هتظهر بيانات الربط والحالة والاختيارات المتاحة للعضو المحدد.</p>
          </div>:<>
            <div className="mb-5 flex items-start justify-between gap-3">
              <div><p className="text-xs font-bold text-[#dfb78c]">MEMBER DETAILS</p>
                <h2 className="mt-2 text-xl font-black">{current.clientName||'عضو CUT CLUB'}</h2>
                <p dir="ltr" className="mt-1 text-right text-sm text-zinc-400">{current.phoneMasked}</p>
              </div><StateTag m={current}/>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#101116] p-4 text-sm leading-7 text-zinc-300">
              {current.accessStatus==='SUSPENDED'
                ?'الحساب موقوف من الإدارة. المحفظة والأرصدة الخاصة مخفية حتى إعادة التفعيل.'
                :current.linkStatus==='ACTIVE'
                  ?'العضو مرتبط بسجل عميل معتمد، ويقدر يشوف محفظته.'
                  :current.linkStatus==='REVIEW_REQUIRED'
                    ?'رقم واتساب متحقق منه، لكن بيانات العميل القديمة تحتاج مراجعة هوية قبل إظهار المحفظة.'
                    :'حساب واتساب متحقق منه ومفعّل؛ مفيش سجل قديم مرتبط حاليًا.'}
            </div>
            {current.accessStatus==='ENABLED'&&current.linkStatus!=='ACTIVE'&&<form onSubmit={approve} className="mt-6 space-y-4">
              <h3 className="flex items-center gap-2 font-bold"><Link2 size={18} className="text-[#e4b681]"/> ربط سجل عميل قديم</h3>
              {candidateLoading?<p className="text-sm text-zinc-400">جاري جلب السجلات المطابقة…</p>:
                candidates?.length ?<div className="space-y-2">
                  {candidates.length>1&&<p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-6 text-amber-200">الرقم مستخدم في أكتر من سجل. لازم التأكد من العميل شخصيًا؛ ممنوع الاختيار تلقائيًا.</p>}
                  {candidates.map(c=><label key={c.clientId} className={'flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 p-3 text-sm '+(c.linkedElsewhere?'opacity-45':'hover:bg-white/5')}>
                    <input type="radio" name="client" disabled={c.linkedElsewhere} checked={clientId===String(c.clientId)} onChange={()=>{setClientId(String(c.clientId));setProof(false);}}/>
                    <span className="flex-1"><strong className="block">{c.name||'بدون اسم'}</strong><span className="text-xs text-zinc-400">Client #{c.clientId} · {c.visits??0} زيارة</span></span>
                    {c.linkedElsewhere&&<span className="text-xs text-rose-300">مرتبط</span>}
                  </label>)}
                </div>:candidates?.length===0?<p className="text-sm text-zinc-400">مفيش سجل قديم بنفس الرقم؛ العضو يقدر يستخدم CUT CLUB بدون محفظة تاريخية.</p>:null}
              {manual?<label className="block text-sm font-semibold">ClientID بعد مراجعة الإدارة
                <input type="number" min="1" value={clientId} onChange={e=>{setClientId(e.target.value);setProof(false);}} className={field+' mt-2'} placeholder="رقم سجل العميل"/>
              </label>:<button type="button" onClick={()=>setManual(true)} className="text-xs text-[#e2bd94] underline underline-offset-4">إدخال ClientID يدويًا</button>}
              <label className="flex items-start gap-3 text-xs leading-6 text-zinc-300">
                <input type="checkbox" checked={proof} onChange={e=>setProof(e.target.checked)} className="mt-1"/>
                أؤكد أني راجعت هوية العميل داخل الفرع وأن رقم السجل يخصه فعلًا.
              </label>
              <button type="submit" disabled={!proof||!clientId||busy||candidateLoading} className={button+' w-full bg-[#e9c9a6] text-[#24151b] hover:bg-white'}><Link2 size={16}/> اعتماد ربط المحفظة</button>
            </form>}
            <div className="mt-6 space-y-3 border-t border-white/10 pt-5">
              <h3 className="flex items-center gap-2 font-bold">{current.accessStatus==='SUSPENDED'?<ShieldCheck size={18} className="text-emerald-300"/>:<LockKeyhole size={18} className="text-amber-300"/>}
                {current.accessStatus==='SUSPENDED'?'إعادة تفعيل الحساب':'إيقاف وصول العضو'}</h3>
              <p className="text-xs leading-6 text-zinc-400">الإجراء بيغيّر الوصول للعضوية فقط، من غير حذف Coins أو القسائم. كل تغيير بيتسجل باسم الموظف والسبب.</p>
              <textarea value={reason} onChange={e=>setReason(e.target.value)} rows={3} maxLength={300}
                placeholder="سبب الإجراء (5 حروف على الأقل)" aria-label="سبب تغيير حالة العضوية"
                className={field+' resize-y py-3'}/>
              {current.accessStatus==='SUSPENDED'
                ?<button type="button" disabled={busy||reason.trim().length<5} onClick={()=>void moderate('RESUME')} className={button+' w-full bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/30 hover:bg-emerald-500/30'}><ShieldCheck size={17}/> إعادة التفعيل</button>
                :<button type="button" disabled={busy||reason.trim().length<5} onClick={()=>void moderate('SUSPEND')} className={button+' w-full bg-rose-500/10 text-rose-200 ring-1 ring-rose-500/30 hover:bg-rose-500/20'}><ShieldOff size={17}/> إيقاف CUT CLUB للعضو</button>}
            </div>
          </>}
        </section>
      </div>
    </div>
  </main>;
}

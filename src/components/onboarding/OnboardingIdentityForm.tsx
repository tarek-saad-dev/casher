'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback,useEffect,useRef,useState } from 'react';
import { ArrowLeft, CheckCircle2, Loader2, Palette, ReceiptText } from 'lucide-react';
import { DRVO_BRAND } from '@/lib/theme';
import type { TenantBrandProfile } from '@/platform/branding/brandProfile';
import { identityDraft,identityPayload,type IdentityDraft } from '@/platform/branding/onboardingIdentity';

const endpoint='/api/tenant/brand';
const input='min-h-12 w-full rounded-xl border border-input bg-surface px-4 py-3 text-base text-foreground outline-none transition-colors focus:border-primary focus:bg-card focus:ring-2 focus:ring-primary/20 sm:text-sm';
const presets=[{name:'كلاسيكي',primary:DRVO_BRAND.plum,accent:DRVO_BRAND.teal},{name:'هادئ',primary:'#263e5c',accent:'#4269bc'},{name:'دافئ',primary:'#62432b',accent:'#b17b48'},{name:'راقي',primary:'#3f3054',accent:'#8a64b4'},{name:'محايد',primary:'#20252b',accent:'#64748b'}];
const safeColor=(value:string,fallback:string)=>/^#[0-9a-f]{6}$/i.test(value)?value:fallback;
const btn='inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50';
export default function OnboardingIdentityForm(){
  const router=useRouter();
  const [profile,setProfile]=useState<TenantBrandProfile|null>(null);
  const [draft,setDraft]=useState<IdentityDraft|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [previewLogo,setPreviewLogo]=useState('');
  const [logoFailed,setLogoFailed]=useState(false);
  const pending=useRef(false);
  const load=useCallback(async(signal?:AbortSignal)=>{
    setLoading(true);setError('');setMessage('');
    try{
      const res=await fetch(endpoint,{cache:'no-store',signal});const data=await res.json();
      if(!res.ok||!data.brand)throw new Error(data.error||'تعذر تحميل الهوية.');
      if(signal?.aborted)return;
      setProfile(data.brand);setDraft(identityDraft(data.brand));setPreviewLogo(data.brand.logoUrl??'');setLogoFailed(false);
    }catch(e){if(!signal?.aborted)setError(e instanceof Error?e.message:'تعذر التحميل.');}
    finally{if(!signal?.aborted)setLoading(false);}
  },[]);
  useEffect(()=>{const ctrl=new AbortController();void load(ctrl.signal);return()=>ctrl.abort();},[load]);
  function patch(update:Partial<IdentityDraft>){setDraft(d=>d?{...d,...update}:d);setMessage('');setError('');}
  async function save(event:React.FormEvent){
    event.preventDefault();if(!profile||!draft||pending.current)return;
    const continueAfterSave=(event.nativeEvent as SubmitEvent).submitter?.getAttribute('value')==='continue';
    pending.current=true;setBusy(true);setError('');setMessage('');
    try{
      const payload=identityPayload(profile,draft);
      const res=await fetch(endpoint,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),cache:'no-store'});
      const data=await res.json().catch(()=>({}));
      if(!res.ok||!data.brand)throw new Error(res.status===409?'تم تعديل الهوية من مكان آخر. حدّث البيانات قبل الحفظ.':data.error||'تعذر الحفظ.');
      setProfile(data.brand);setDraft(identityDraft(data.brand));setPreviewLogo(data.brand.logoUrl??'');setLogoFailed(false);setMessage('تم حفظ الهوية الخاصة بمنشأتك.');
      if(continueAfterSave)router.push('/setup/branch');
    }catch(e){setError(e instanceof Error?e.message:'تعذر الحفظ.');}
    finally{pending.current=false;setBusy(false);}
  }
  if(loading)return <div role="status" className="rounded-2xl bg-card p-8 text-sm"><Loader2 className="me-2 inline h-5 w-5 animate-spin"/> جاري تحميل الهوية…</div>;
  if(!profile||!draft)return <div className="rounded-2xl bg-card p-5"><p role="alert" className="text-sm text-destructive">{error||'تعذر تحميل الهوية.'}</p><button type="button" onClick={()=>void load()} className={'mt-3 '+btn}>إعادة المحاولة</button></div>;
  const primary=safeColor(draft.primaryColor,DRVO_BRAND.plum),accent=safeColor(draft.accentColor,DRVO_BRAND.teal);
  const logo=previewLogo&&!logoFailed;
  const initial=(draft.displayName.trim().charAt(0)||'؟').toUpperCase();
  const dirty=JSON.stringify(draft)!==JSON.stringify(identityDraft(profile));
  return <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
    <header className="bg-brand-soft p-6 text-foreground sm:p-9"><div className="flex items-center gap-2 text-xs font-bold text-brand"><Palette className="h-5 w-5"/> تخصيص مساحة العمل</div><h1 className="mt-3 text-2xl font-black sm:text-4xl">خلّي النظام يشبه بيزنسك.</h1><p className="mt-2 text-sm leading-7 text-muted-foreground">اختار اسم وشعار وألوان نشاطك. شوف شكل النظام والإيصال قبل ما تحفظ، وكمّل تجهيز الفرع لما تكون جاهز.</p></header>
    <div className="grid gap-7 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)] sm:p-8">
      <form onSubmit={save} className="min-w-0 space-y-5">
        <fieldset disabled={busy} className="min-w-0 space-y-6">
          <div className="border-b border-border pb-3"><h2 className="text-base font-black">بيانات الهوية</h2><p className="mt-1 text-xs leading-6 text-muted-foreground">هتظهر في واجهات منشأتك المتصلة بالهوية.</p></div>
          <label className="block text-sm font-bold">الاسم الظاهر للمنشأة<input maxLength={128} required value={draft.displayName} onChange={e=>patch({displayName:e.target.value})} className={'mt-2 '+input}/></label>
          <div><label className="block text-sm font-bold">رابط الشعار — اختياري<input dir="ltr" maxLength={512} value={draft.logoUrl} onChange={e=>patch({logoUrl:e.target.value})} placeholder="https://…" className={'mt-2 '+input}/></label><button type="button" onClick={()=>{try{identityPayload(profile,draft);setPreviewLogo(draft.logoUrl.trim());setLogoFailed(false);setError('');}catch(e){setError(e instanceof Error?e.message:'راجع الرابط.');}}} className="mt-2 rounded-lg border border-input px-3 py-2 text-xs font-bold">معاينة الشعار</button><p className="mt-1 text-xs leading-6 text-muted-foreground">استخدم رابط صورة HTTPS تملك حق استخدامها. رفع ملف مباشر غير متاح هنا.</p></div>
          <div><h2 className="text-base font-black">اختار ألوانك</h2><p className="mt-1 text-xs leading-6 text-muted-foreground">ابدأ بتنسيق جاهز أو خصّص كل لون بنفسك.</p><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{presets.map(p=><button type="button" key={p.name} aria-pressed={primary.toLowerCase()===p.primary.toLowerCase()&&accent.toLowerCase()===p.accent.toLowerCase()} onClick={()=>patch({primaryColor:p.primary,accentColor:p.accent})} className={'flex items-center gap-2 rounded-xl border p-3 text-xs font-bold '+(primary.toLowerCase()===p.primary.toLowerCase()&&accent.toLowerCase()===p.accent.toLowerCase()?'border-primary bg-primary-soft':'border-border')}><span className="h-6 w-6 rounded-full border border-border" style={{background:p.primary}}/><span className="-ms-3 h-6 w-6 rounded-full border-2 border-border" style={{background:p.accent}}/>{p.name}</button>)}</div><div className="mt-3 grid gap-3 sm:grid-cols-2">{([{key:'primaryColor',label:'اللون الأساسي',fallback:DRVO_BRAND.plum},{key:'accentColor',label:'اللون الثانوي',fallback:DRVO_BRAND.teal}] as const).map(x=><label key={x.key} className="block text-xs font-bold">{x.label}<div className="mt-2 flex items-center gap-2"><input type="color" value={safeColor(draft[x.key],x.fallback)} onChange={e=>patch({[x.key]:e.target.value})} className="h-11 w-12 shrink-0 rounded-lg border border-input"/><input dir="ltr" value={draft[x.key]} maxLength={7} placeholder={x.fallback} onChange={e=>patch({[x.key]:e.target.value})} className={input+' min-w-0'}/></div></label>)}</div></div>
          <label className="block text-sm font-bold">رسالة أسفل الإيصال — اختياري<textarea rows={3} maxLength={256} value={draft.receiptFooter} onChange={e=>patch({receiptFooter:e.target.value})} className={'mt-2 '+input} placeholder="شكرًا لزيارتكم"/></label>
        </fieldset>
        {error&&<p role="alert" className="rounded-xl bg-destructive-soft p-3 text-sm text-destructive">{error}</p>}
        {message&&<p role="status" className="rounded-xl bg-success-soft p-3 text-sm text-success">{message}</p>}
        <div className="space-y-3 border-t border-border pt-5">
          <p role="status" className="text-xs text-muted-foreground">{dirty?'عندك تعديلات لم تُحفظ بعد.':'الهوية الحالية محفوظة.'}</p>
          <div className="flex flex-wrap gap-2">
            {dirty?<button type="submit" value="continue" disabled={busy} className={btn}>{busy?<Loader2 className="h-4 w-4 animate-spin"/>:<ArrowLeft className="h-4 w-4"/>}حفظ ومتابعة</button>:<Link href="/setup/branch" className={btn}>متابعة التجهيز <ArrowLeft className="h-4 w-4"/></Link>}
            <button type="submit" value="save" disabled={busy||!dirty} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-input px-4 py-2 text-sm font-bold disabled:opacity-50"><CheckCircle2 className="h-4 w-4"/>حفظ الهوية</button>
            <button type="button" disabled={busy||!dirty} onClick={()=>{setDraft(identityDraft(profile));setPreviewLogo(profile.logoUrl??'');setLogoFailed(false);setMessage('');setError('');}} className="rounded-xl border border-input px-4 py-2 text-xs font-bold disabled:opacity-50">إلغاء التعديلات</button>
            <button type="button" disabled={busy||dirty} onClick={()=>void load()} className="rounded-xl px-3 py-2 text-xs font-bold text-muted-foreground disabled:opacity-50">تحديث البيانات</button>
          </div>
          {dirty&&!busy&&<Link href="/setup/branch" className="inline-flex items-center gap-1 text-xs font-bold text-muted-foreground underline">متابعة بدون حفظ <ArrowLeft className="h-3 w-3"/></Link>}
        </div>
      </form>
      <aside className="min-w-0 space-y-4 lg:sticky lg:top-5 lg:self-start">
        <div className="flex items-center justify-between gap-2"><h2 className="text-base font-black">معاينة الهوية</h2><span className="rounded-full bg-primary-soft px-2.5 py-1 text-xs font-bold text-primary">شكل تقريبي</span></div>
        <div className="overflow-hidden rounded-2xl border border-border"><div className="p-4" style={{background:primary}}><div className="flex items-center gap-3"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-card text-lg font-black" style={{color:primary}}>{logo?<img src={previewLogo} referrerPolicy="no-referrer" alt="" onError={()=>setLogoFailed(true)} className="h-10 w-10 object-contain"/>:initial}</div><div className="min-w-0 break-words rounded-lg bg-card px-3 py-2 font-black text-foreground">{draft.displayName||'اسم منشأتك'}</div></div></div><div className="space-y-3 bg-muted p-5"><div className="h-2 w-1/3 rounded-full" style={{background:accent}}/><div className="grid grid-cols-2 gap-2"><div className="rounded-xl border border-border bg-card p-3 text-xs font-bold">الكاشير</div><div className="rounded-xl border border-border bg-card p-3 text-xs font-bold">الخدمات</div></div></div></div>
        <div className="rounded-2xl border border-border bg-muted p-4"><div className="mb-3 flex items-center gap-2 text-xs font-bold"><ReceiptText className="h-4 w-4"/> معاينة الإيصال</div><div className="rounded-xl bg-card p-4 text-center text-xs shadow-sm"><div className="font-bold break-words">{draft.displayName||'اسم المنشأة'}</div><div className="my-2 border-t border-dashed border-input"/><div className="flex justify-between"><span>خدمة — مثال</span><span>100.00 ج.م</span></div><div className="my-2 border-t border-dashed border-input"/><p className="break-words text-muted-foreground">{draft.receiptFooter||'شكرًا لزيارتكم'}</p></div></div>
        {logoFailed&&<p role="status" className="rounded-lg bg-warning-soft p-3 text-xs text-warning">تعذر عرض الشعار. راجع رابط الصورة وجرب المعاينة مرة أخرى.</p>}<p className="text-xs leading-6 text-muted-foreground">المعاينة مش فاتورة فعلية. ظهور الألوان يعتمد على الشاشات التي تستخدم هوية المنشأة الحالية.</p>
      </aside>
    </div>
  </div>;
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, AlertCircle } from 'lucide-react';
import { platformFetch } from '@/components/platform/platformFetch';
import { appManagerLabel } from '@/platform/apps/selfServiceAppManager';

type Cycle = 'monthly'|'annual';
type Choice = {code:string;group:'required'|'recommended'|'optional';selectable:boolean};
type DraftData = {
  mode:'draft_only';canCharge:false;canActivate:false;changesInstalledApps:false;changesSubscription:false;
  industry:string;catalog:{code:string;status:'draft';version:1};
  options:Choice[];
  draft:null|{draftId:string;apps:string[];branches:number;billingCycle:Cycle;revision:number;updatedAt:string};
  protectedTenant:boolean;
  paid?:false;subscriptionChanged?:false;installedAppsChanged?:false;
};
const groupNames={required:'أساسي',recommended:'موصى به',optional:'اختياري'};

export default function ModularDraftClient() {
  const [data,setData]=useState<DraftData|null>(null);
  const [apps,setApps]=useState<string[]>([]);
  const [branches,setBranches]=useState(1);
  const [cycle,setCycle]=useState<Cycle>('monthly');
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [note,setNote]=useState<string|null>(null);

  const apply = useCallback((response:DraftData) => {
    if (response.mode!=='draft_only'||response.canCharge!==false||response.canActivate!==false) {
      throw new Error('حالة المسودة غير متوقعة');
    }
    setData(response);
    setApps(response.draft?.apps ?? response.options.filter(x=>x.group==='required'&&x.selectable).map(x=>x.code));
    setBranches(response.draft?.branches ?? 1);
    setCycle(response.draft?.billingCycle ?? 'monthly');
  },[]);
  const load=useCallback(async()=>{
    const response=await platformFetch<DraftData>('/api/tenant/modular-draft');
    apply(response);
  },[apply]);
  useEffect(()=>{
    let active=true;
    platformFetch<DraftData>('/api/tenant/modular-draft')
      .then(response=>{if(active)apply(response);})
      .catch((e:Error)=>{if(active)setError(e.message);})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[apply]);

  const save=async()=>{
    if (!data||data.protectedTenant||saving) return;
    setSaving(true);setError(null);setNote(null);
    try {
      const result=await platformFetch<DraftData>('/api/tenant/modular-draft',{
        method:'PUT',body:JSON.stringify({
          apps,branches,billingCycle:cycle,expectedRevision:data.draft?.revision ?? null,
        }),
      });
      if (result.paid!==false||result.subscriptionChanged!==false||
          result.installedAppsChanged!==false) throw new Error('حالة الحفظ غير متوقعة');
      apply(result);
      setNote('اتحفظت اختياراتك كمسودة فقط. مفيش دفع أو تغيير للتطبيقات الشغالة.');
    } catch(e){
      setError(e instanceof Error?e.message:'تعذر حفظ المسودة');
      try{await load();}catch{/* retain current contents */}
    }finally{setSaving(false);}
  };

  return <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
    <div className="space-y-2">
      <h2 className="text-lg font-bold">جهّز اختيارات التطبيقات</h2>
      <p className="text-sm leading-7 text-muted-foreground">
        اختار التطبيقات وعدد الفروع اللي ممكن تحتاجهم. دي مسودة للتخطيط بس؛ الحفظ مش بيثبت تطبيق،
        ولا يغيّر اشتراكك أو يطلب منك فلوس. الأسعار النهائية لسه ما اتعتمدتش.
      </p>
    </div>
    {loading&&<p role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/> جاري تحميل الاختيارات…</p>}
    {error&&<div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-500/30 p-3 text-sm text-rose-600">
      <AlertCircle className="h-4 w-4 shrink-0"/><span>{error}</span>
      <button type="button" className="mr-auto underline" onClick={()=>{setError(null);void load().catch((e:Error)=>setError(e.message));}}>إعادة المحاولة</button>
    </div>}
    {note&&<p role="status" className="inline-flex items-center gap-2 text-sm text-emerald-600"><Check className="h-4 w-4"/>{note}</p>}
    {data&&<>
      {data.protectedTenant&&<p className="text-sm text-muted-foreground">الحساب الرئيسي محمي من تعديل مسودات الاشتراكات.</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {data.options.map(option=><label key={option.code}
          className={'flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm ' +
            (!option.selectable?'opacity-60':'')}>
          <span className="flex items-center gap-2">
            <input type="checkbox"
              checked={apps.includes(option.code)}
              disabled={!option.selectable||option.group==='required'||saving||data.protectedTenant}
              onChange={e=>{
                setNote(null);
                setApps(old=>e.target.checked?[...old,option.code]:old.filter(x=>x!==option.code));
              }}/>
            <span>{appManagerLabel(option.code)}</span>
          </span>
          <span className="text-xs text-muted-foreground">
            {!option.selectable?'غير متاح حاليًا':groupNames[option.group]}
          </span>
        </label>)}
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">الفروع المخطط لها
          <select aria-label="عدد الفروع للمسودة" value={branches}
            disabled={saving||data.protectedTenant}
            className="min-h-10 rounded-lg border border-border bg-background px-3"
            onChange={e=>{setBranches(Number(e.target.value));setNote(null);}}>
            {Array.from({length:20},(_,i)=>i+1).map(n=><option value={n} key={n}>{n}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">الدورية المحتملة
          <select aria-label="دورية المسودة" value={cycle}
            disabled={saving||data.protectedTenant}
            className="min-h-10 rounded-lg border border-border bg-background px-3"
            onChange={e=>{setCycle(e.target.value as Cycle);setNote(null);}}>
            <option value="monthly">شهري</option><option value="annual">سنوي</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {data.draft? 'المسودة محفوظة · إصدار '+data.draft.revision : 'لسه مفيش مسودة محفوظة'}
        </p>
        {!data.protectedTenant&&<button type="button" disabled={saving} onClick={()=>void save()}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 py-2 font-semibold text-primary-foreground disabled:opacity-50">
          {saving?<Loader2 className="h-4 w-4 animate-spin"/>:<Check className="h-4 w-4"/>}
          حفظ المسودة
        </button>}
      </div>
      <p className="text-xs leading-6 text-muted-foreground">
        عدد الفروع هنا للتخطيط فقط ولا يضيف فروع فعلية. لا توجد أي رسوم أو أسعار ملزمة،
        ومش هيتغير أي جزء من تشغيل المحل نتيجة الحفظ.
      </p>
    </>}
  </section>;
}

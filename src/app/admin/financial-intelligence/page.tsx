'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, BrainCircuit, CalendarClock, CircleCheck, Download, Loader2, Plus, RefreshCw, ShieldAlert, Wallet } from 'lucide-react';
import type { FinanceOverview } from '@/lib/financial-intelligence/data';
import type { CommitmentKind } from '@/lib/financial-intelligence/forecast';

type ApiOverview = {ok:true;data:FinanceOverview;canManage:boolean};
type AIAnalysis = { summary:string;risks:string[];actions:string[] };
const KIND_OPTIONS: Array<{value:CommitmentKind;label:string}> = [
  {value:'rent',label:'إيجار'},{value:'payroll',label:'رواتب مستحقة'},
  {value:'installment',label:'قسط'},{value:'debt',label:'دين'},
  {value:'supplier',label:'مورد'},{value:'utilities',label:'مرافق'},{value:'other',label:'أخرى'},
];
const fmt = (n:number) => new Intl.NumberFormat('ar-EG',{maximumFractionDigits:0}).format(n) + ' ج';
const todayCairo = () => new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Cairo'});
const baseInput = 'w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30';
function Tile({label,value,note,icon}:{label:string;value:string;note?:string;icon:React.ReactNode}) {
  return <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
    <div className="flex items-center justify-between text-sm text-muted-foreground"><span>{label}</span>{icon}</div>
    <div className="text-xl sm:text-2xl font-bold tabular-nums">{value}</div>
    {note && <p className="text-xs text-muted-foreground">{note}</p>}
  </div>;
}
function Trend({data}:{data:FinanceOverview['forecast']['days']}) {
  const points=useMemo(()=>{
    if(!data.length) return '';
    const values=data.map(d=>d.projectedCash);
    const min=Math.min(0,...values), max=Math.max(1,...values), spread=Math.max(1,max-min);
    return data.map((d,i)=>((34+i*(704/Math.max(1,data.length-1))).toFixed(1))+','+(186-(d.projectedCash-min)/spread*152).toFixed(1)).join(' ');
  },[data]);
  return <div className="overflow-hidden rounded-xl border border-border bg-background p-3">
    <svg viewBox="0 0 770 222" className="w-full h-auto" role="img" aria-label="توقع رصيد الخزنة خلال 30 يومًا">
      <line x1="34" y1="186" x2="738" y2="186" stroke="currentColor" strokeOpacity=".15"/>
      <line x1="34" y1="34" x2="34" y2="186" stroke="currentColor" strokeOpacity=".12"/>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>
      {data.filter((_,i)=>i%7===0 || i===data.length-1).map(d=>{
        const i=data.indexOf(d), x=34+i*704/Math.max(1,data.length-1);
        return <text key={d.date} x={x} y="210" textAnchor="middle" fontSize="13" fill="currentColor" opacity=".6">{d.date.slice(5)}</text>;
      })}
    </svg>
    <p className="text-xs text-muted-foreground">خط اتجاه تقديري وليس رصيدًا بنكيًا مؤكدًا. يعتمد على متوسط الحركة المسجلة والالتزامات المضافة.</p>
  </div>;
}

export default function FinancialIntelligencePage() {
  const [scope,setScope]=useState<'single'|'all'>('single');
  const [result,setResult]=useState<ApiOverview|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [analysis,setAnalysis]=useState<AIAnalysis|null>(null);
  const [aiError,setAiError]=useState('');
  const [title,setTitle]=useState('');
  const [kind,setKind]=useState<CommitmentKind>('rent');
  const [amount,setAmount]=useState('');
  const [dueDate,setDueDate]=useState(todayCairo);
  const [frequency,setFrequency]=useState<'once'|'monthly'>('monthly');
  const [endDate,setEndDate]=useState('');
  const [branchId,setBranchId]=useState<number|null>(null);
  const [payAmounts,setPayAmounts]=useState<Record<string,string>>({});
  const query=scope==='all'?'?scope=all':'';
  const load=useCallback(async ()=>{
    setLoading(true);setError('');
    try {
      const response=await fetch('/api/admin/financial-intelligence'+(scope==='all'?'?scope=all':''),{cache:'no-store'});
      const json=await response.json();
      if(!response.ok) throw new Error(json.error || 'تعذر تحميل بيانات المركز المالي');
      const value=json as ApiOverview;
      setResult(value);
      setBranchId(current=>value.data.branches.some(b=>b.branchId===current)?current:value.data.branches[0]?.branchId??null);
    }catch(err){setError(err instanceof Error?err.message:'حدث خطأ');setResult(null);}
    finally{setLoading(false);}
  },[scope]);
  useEffect(()=>{void load();},[load]);

  async function write(action:Record<string,unknown>,key:string) {
    setBusy(key);setError('');setMessage('');
    try {
      const response=await fetch('/api/admin/financial-intelligence'+query,{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action),
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'فشل حفظ التغيير');
      setMessage(data.warning||'تم الحفظ بنجاح');
      await load();
      return true;
    }catch(err){setError(err instanceof Error?err.message:'فشل حفظ التغيير');return false;}
    finally{setBusy('');}
  }
  async function addCommitment(e:React.FormEvent) {
    e.preventDefault();
    if(!branchId)return;
    const ok=await write({
      action:'add',branchId,title,kind,amount:Number(amount),dueDate,frequency,endDate:endDate||null,
    },'add');
    if(ok){setTitle('');setAmount('');}
  }
  async function generateInsights(){
    setBusy('ai');setAiError('');setAnalysis(null);
    try {
      const response=await fetch('/api/admin/financial-intelligence/insights'+query,{method:'POST'});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'تعذر تحليل الأرقام');
      setAnalysis(data.analysis);
    }catch(err){setAiError(err instanceof Error?err.message:'تعذر التحليل');}
    finally{setBusy('');}
  }
  const view=result?.data;
  const forecast=view?.forecast;
  const risk=forecast?.firstNegativeDay;
  return <main className="mx-auto max-w-7xl space-y-6 pb-16" dir="rtl">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-semibold tracking-wider text-muted-foreground">CUT SALON / FINANCIAL INTELLIGENCE</p>
        <h1 className="mt-1 text-2xl sm:text-3xl font-bold">مركز القيادة المالية</h1>
        <p className="mt-2 text-sm text-muted-foreground">مؤشرات اليوم، التزامات الشهر، وتوقعات السيولة قبل الاستحقاق</p>
      </div>
      <div className="flex items-center flex-wrap gap-2 print:hidden">
        <button type="button" onClick={()=>setScope(scope==='single'?'all':'single')} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent" aria-pressed={scope==='all'}>
          {scope==='all'?'كل الفروع • عرض إجمالي':'الفرع الحالي • عرض مفرد'}
        </button>
        <button type="button" onClick={()=>void load()} className="rounded-lg border border-border p-2 hover:bg-accent" title="تحديث" disabled={loading}><RefreshCw className={'h-4 w-4'+(loading?' animate-spin':'')}/></button>
        <button type="button" onClick={()=>window.print()} className="rounded-lg border border-border p-2 hover:bg-accent" title="طباعة"><Download className="h-4 w-4"/></button>
      </div>
    </div>
    {error && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
    {message && <div role="status" className="rounded-xl border border-border bg-card p-3 text-sm flex gap-2 items-center"><CircleCheck className="h-4 w-4"/>{message}</div>}
    {loading && !view && <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin"/>تحميل البيانات المالية…</div>}
    {view && forecast && <>
      <div className="flex flex-wrap items-center gap-3">
        <span className={'rounded-full px-3 py-1 text-sm font-semibold '+(risk?'bg-amber-500/10 text-amber-700 dark:text-amber-400':'bg-muted text-foreground')}>
          {risk?'إنذار: عجز دفتري متوقع يوم '+risk:'لم يظهر عجز ضمن الأرقام المتاحة'}
        </span>
        <span className="text-xs text-muted-foreground">التاريخ: {view.asOf} • التوقع {forecast.dataQuality==='estimated'?'تقديري':'غير مكتمل'}</span>
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Tile label="رصيد الخزنة الدفتري" value={fmt(view.totals.bookCash)} note="ليس بالضرورة سيولة قابلة للصرف" icon={<Wallet className="h-4 w-4"/>}/>
        <Tile label="التزامات حتى 7 أيام" value={fmt(forecast.due7)} note="شامل المستحقات المتأخرة" icon={<CalendarClock className="h-4 w-4"/>}/>
        <Tile label="إيراد الخدمات المسجل هذا الشهر" value={fmt(view.totals.servicesRevenueMTD)} note="لا يشمل بالضرورة جميع أنواع الإيرادات" icon={<ArrowUpRight className="h-4 w-4"/>}/>
        <Tile label="تكلفة الرواتب المسجلة" value={fmt(view.totals.payrollAccruedMTD)} note="من دفتر الرواتب، ليست المستحقات غير المدفوعة" icon={<ArrowDownRight className="h-4 w-4"/>}/>
      </div>
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
        <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-lg">توقع السيولة خلال 30 يومًا</h2>
            <span className="text-xs text-muted-foreground">أقل رصيد متوقع: {forecast.minimumCash30===null?'غير متاح':fmt(forecast.minimumCash30)}</span>
          </div>
          <Trend data={forecast.days}/>
          <div className="grid grid-cols-2 gap-3">
            <Tile label="التزامات 14 يومًا" value={fmt(forecast.due14)} icon={<CalendarClock className="h-4 w-4"/>}/>
            <Tile label="التزامات 30 يومًا" value={fmt(forecast.due30)} icon={<ShieldAlert className="h-4 w-4"/>}/>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-4">
          <div className="flex items-center gap-2"><BrainCircuit className="h-5 w-5"/><h2 className="text-lg font-semibold">تحليل المدير الذكي</h2></div>
          <p className="text-sm text-muted-foreground">Gemini يحلل الأرقام المجمعة بعد طلبك، ويقترح قرارات. لا ينفّذ أي حركة مالية.</p>
          <button type="button" disabled={busy==='ai'} onClick={()=>void generateInsights()} className="w-full rounded-lg bg-primary px-4 py-2.5 text-primary-foreground disabled:opacity-60 print:hidden">
            {busy==='ai'?'جاري التحليل…':'حلّل الوضع باستخدام Gemini'}
          </button>
          {aiError && <p className="text-sm text-amber-700 dark:text-amber-400" role="alert">{aiError}</p>}
          {analysis ? <div className="space-y-3 text-sm">
            <p className="font-medium">{analysis.summary}</p>
            {!!analysis.risks.length && <div><h3 className="font-semibold mb-1">المخاطر</h3><ul className="list-disc pr-5 space-y-1">{analysis.risks.map((x,i)=><li key={i}>{x}</li>)}</ul></div>}
            {!!analysis.actions.length && <div><h3 className="font-semibold mb-1">القرارات المقترحة</h3><ul className="list-disc pr-5 space-y-1">{analysis.actions.map((x,i)=><li key={i}>{x}</li>)}</ul></div>}
            <p className="text-xs text-muted-foreground">توصيات إرشادية، وليست حقائق محاسبية أو موافقات صرف.</p>
          </div> : <div className="rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">التحليل الرقمي يعمل حتى لو Gemini غير مفعّل. تحتاج إضافة مفتاح Gemini في إعدادات السيرفر لتفعيل التوصيات.</div>}
        </div>
      </section>
      <section className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-3">
        <h2 className="text-lg font-semibold">مؤشرات الفروع</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-b border-border"><tr><th className="p-3 text-right">الفرع</th><th className="p-3 text-right">رصيد دفتري</th><th className="p-3 text-right">إيراد الخدمات</th><th className="p-3 text-right">صافي حركة الخزنة</th><th className="p-3 text-right">تكلفة الرواتب المسجلة</th></tr></thead>
            <tbody>{view.branches.map(b=><tr key={b.branchId} className="border-b border-border/60"><td className="p-3 font-medium">{b.branchName}</td><td className="p-3">{fmt(b.bookCash)}</td><td className="p-3">{fmt(b.servicesRevenueMTD)}</td><td className="p-3">{fmt(b.treasuryNetMTD)}</td><td className="p-3">{fmt(b.payrollAccruedMTD)}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,1fr)]">
        <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-4">
          <h2 className="text-lg font-semibold">أقرب الالتزامات</h2>
          {!forecast.dueItems.length ? <p className="text-sm text-muted-foreground">لا توجد التزامات مسجلة في نطاق الثلاثين يومًا القادم أو متأخرات ظاهرة. لا يعني ذلك عدم وجود ديون غير مسجلة.</p> :
            <div className="space-y-2">
              {forecast.dueItems.slice(0,35).map(item=>{
                const key=item.id+'-'+item.occurrenceDate;
                return <div key={key} className="rounded-xl border border-border px-3 py-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div><p className="font-medium text-sm">{item.title}</p><p className="text-xs text-muted-foreground">{item.occurrenceDate} • {item.frequency==='monthly'?'شهري':'مرة واحدة'} • {view.branches.find(b=>b.branchId===item.branchId)?.branchName||'فرع'}</p></div>
                    <div className="text-left shrink-0"><p className="font-bold text-sm">{fmt(item.remaining)}</p>{item.overdue && <span className="text-xs text-amber-700 dark:text-amber-400">متأخر</span>}</div>
                  </div>
                  {result.canManage && <div className="flex gap-2 items-center print:hidden">
                    <input aria-label={'مبلغ السداد '+item.title} inputMode="decimal" type="number" min="0.01" step="0.01" max={item.remaining} value={payAmounts[key]||''}
                      onChange={e=>setPayAmounts(prev=>({...prev,[key]:e.target.value}))}
                      placeholder="مبلغ مسدد فعليًا" className={baseInput+' max-w-44'}/>
                    <button type="button" disabled={busy==='settle'+key || !(Number(payAmounts[key])>0)}
                      onClick={async()=>{const ok=await write({action:'settle',branchId:item.branchId,commitmentId:item.id,dueDate:item.occurrenceDate,amount:Number(payAmounts[key])},'settle'+key);if(ok)setPayAmounts(p=>({...p,[key]:''}));}}
                      className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-40">تسجيل سداد</button>
                  </div>}
                </div>;
              })}
            </div>}
          <p className="text-xs text-muted-foreground">تسجيل السداد يحدّث حالة الالتزام فقط، ولا ينشئ حركة خزنة أو يسحب المال من النظام تلقائيًا.</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-4">
          <h2 className="flex gap-2 items-center text-lg font-semibold"><Plus className="h-5 w-5"/>تسجيل التزام مالي</h2>
          {result.canManage ? <form onSubmit={e=>void addCommitment(e)} className="space-y-3 print:hidden">
            <label className="block text-sm">الفرع<select className={baseInput+' mt-1'} value={branchId||''} onChange={e=>setBranchId(Number(e.target.value))} required>{view.branches.map(b=><option key={b.branchId} value={b.branchId}>{b.branchName}</option>)}</select></label>
            <label className="block text-sm">الاسم<input className={baseInput+' mt-1'} value={title} onChange={e=>setTitle(e.target.value)} required maxLength={160} placeholder="مثال: إيجار فرع جليم"/></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-sm">النوع<select className={baseInput+' mt-1'} value={kind} onChange={e=>setKind(e.target.value as CommitmentKind)}>{KIND_OPTIONS.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select></label>
              <label className="block text-sm">المبلغ<input className={baseInput+' mt-1'} type="number" min="0.01" step="0.01" required value={amount} onChange={e=>setAmount(e.target.value)} /></label>
              <label className="block text-sm">تاريخ الاستحقاق<input className={baseInput+' mt-1'} type="date" required value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label>
              <label className="block text-sm">التكرار<select className={baseInput+' mt-1'} value={frequency} onChange={e=>setFrequency(e.target.value as 'once'|'monthly')}><option value="once">مرة واحدة</option><option value="monthly">شهري</option></select></label>
            </div>
            {frequency==='monthly' && <label className="block text-sm">تاريخ نهاية الالتزام (اختياري)<input className={baseInput+' mt-1'} type="date" min={dueDate} value={endDate} onChange={e=>setEndDate(e.target.value)}/></label>}
            <button disabled={busy==='add'} type="submit" className="w-full rounded-lg bg-primary py-2.5 font-semibold text-primary-foreground disabled:opacity-60">{busy==='add'?'جاري الحفظ…':'حفظ الالتزام'}</button>
          </form> : <p className="text-sm text-muted-foreground">تسجيل وتعديل الالتزامات متاح للمحاسب والإدارة المصرح لهم فقط.</p>}
        </div>
      </section>
      <section className="rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap justify-between items-center gap-2"><h2 className="font-semibold text-lg">التقفيل الدوري • 7 / 14 / 21 / 28</h2>
          {result.canManage && <button className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-60 print:hidden" disabled={busy==='snapshot'} onClick={()=>void write({action:'snapshot'},'snapshot')}>{busy==='snapshot'?'جاري الحفظ…':'حفظ لقطة مالية اليوم'}</button>}
        </div>
        <p className="text-xs text-muted-foreground">التقارير المحفوظة لا تتغير بعد الحفظ. جدولة الالتقاط التلقائي ستُضاف في مرحلة التشغيل المجدول.</p>
        {view.snapshots.length ? <div className="flex gap-2 flex-wrap">{view.snapshots.map(s=><span key={s.id} className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">{s.asOfDate}</span>)}</div> : <p className="text-sm text-muted-foreground">لا توجد لقطات محفوظة لهذا النطاق بعد.</p>}
      </section>
      <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
        <h2 className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-5 w-5"/>ملاحظات على دقة البيانات</h2>
        <ul className="list-disc pr-5 text-sm space-y-1 text-muted-foreground">{view.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul>
      </section>
    </>}
  </main>;
}

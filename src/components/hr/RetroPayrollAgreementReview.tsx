'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CompensationBranch } from '@/components/hr/EmployeeBranchPayrollFields';

type Preview = {
  effectiveFrom: string; previousDailyAmount: number; previousLedgerCredits: number;
  proposedMonthlyAmount: number; difference: number; dailyCount: number;
  paidOut: number; advances: number; deductions: number;
  proratedDays: number; daysInMonth: number; blockers: string[];
};

type Props = {
  empId: number;
  effectiveFrom: string;
  branches: CompensationBranch[];
  onApplied: (message: string) => void;
};

const currency = (n: number) => new Intl.NumberFormat('en-US', {maximumFractionDigits:2}).format(n);

export default function RetroPayrollAgreementReview({empId,effectiveFrom,branches,onApplied}:Props) {
  const [reason,setReason] = useState('');
  const [preview,setPreview] = useState<Preview|null>(null);
  const [loading,setLoading] = useState(false);
  const [applying,setApplying] = useState(false);
  const [error,setError] = useState('');
  const key=useRef<string|null>(null);

  const signature=JSON.stringify({effectiveFrom,branches:branches.map(b=>[
    b.branchId,b.enabled,b.monthlySalary
  ]),reason});
  useEffect(()=>{
    setPreview(null);
    setError('');
    key.current=null;
  },[signature]);

  const body=()=>({
    effectiveFrom,
    reason:reason.trim(),
    branches:branches.map(b=>({
      branchId:b.branchId,enabled:b.enabled,monthlySalary:Number(b.monthlySalary)||0
    })),
  });

  const request=async(action:'preview'|'apply')=>{
    const response=await fetch('/api/admin/employees/'+empId+'/payroll-agreement/'+action,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(action==='apply'
        ? {...body(),requestKey:key.current}
        : body()),
    });
    const data=await response.json();
    if(!response.ok) throw new Error(data.error||'تعذر مراجعة اتفاقية القبض');
    return data;
  };

  const review=async()=>{
    setLoading(true);
    setError('');
    try {
      const data=await request('preview');
      setPreview(data.preview as Preview);
    } catch(e:unknown) {setError(e instanceof Error?e.message:'تعذر تحميل المعاينة');}
    finally{setLoading(false);}
  };

  const approve=async()=>{
    if(!preview || preview.blockers.length) return;
    if(!key.current) key.current=crypto.randomUUID();
    setApplying(true);setError('');
    try {
      const data=await request('apply');
      onApplied('تم اعتماد الاتفاقية وتسوية '+data.supersededDailyRows+
        ' يومية، وإثبات المرتب الشهري في الدفتر. رقم المراجعة: '+data.revisionId);
    } catch(e:unknown) {setError(e instanceof Error?e.message:'تعذر اعتماد التسوية');}
    finally{setApplying(false);}
  };
  return (
    <section className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="h-4 w-4 text-primary"/> اتفاقية جديدة بأثر رجعي
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        سيحسب النظام المرتب الشهري للفترة من تاريخ السريان حتى نهاية الشهر بنسبة الأيام،
        ويعرض اليوميات التي سيلغي أثرها قبل الاعتماد.
        السلف والمدفوعات والخزنة والحضور تظل محفوظة كما هي.
      </p>
      <div className="space-y-1">
        <Label>سبب تغيير اتفاقية القبض *</Label>
        <Input value={reason} onChange={e=>setReason(e.target.value)}
          placeholder="مثال: اتفاق جديد مع الموظف يسري من أول الشهر"/>
      </div>
      <Button type="button" variant="outline" className="w-full gap-2"
        disabled={loading||applying||reason.trim().length<8}
        onClick={()=>void review()}>
        {loading?<Loader2 className="h-4 w-4 animate-spin"/>:
          <RefreshCw className="h-4 w-4"/>}
        معاينة أثر التغيير
      </Button>
      {preview && <div className="rounded-lg border border-border bg-background/70 p-3 space-y-2">
        <p className="text-sm font-semibold">نتيجة معاينة التسوية</p>
        <div className="flex justify-between text-sm"><span>اليوميات المتأثرة</span>
          <strong>{preview.dailyCount} يومية</strong></div>
        <div className="flex justify-between text-sm"><span>قيمة اليوميات السابقة</span>
          <strong>{currency(preview.previousDailyAmount)} ج.م</strong></div>
        <div className="flex justify-between text-sm"><span>قيود الأجر القديمة بالدفتر</span>
          <strong>{currency(preview.previousLedgerCredits)} ج.م</strong></div>
        <div className="flex justify-between text-sm"><span>المرتب الشهري الجديد ({preview.proratedDays}/{preview.daysInMonth} يوم)</span>
          <strong>{currency(preview.proposedMonthlyAmount)} ج.م</strong></div>
        <div className="flex justify-between text-sm border-t border-border pt-2">
          <span>فرق الاستحقاق</span><strong>{currency(preview.difference)} ج.م</strong></div>
        <p className="text-xs text-muted-foreground">المدفوعات المسجلة: {currency(preview.paidOut)} ج.م،
          السلف: {currency(preview.advances)} ج.م،
          الخصومات: {currency(preview.deductions)} ج.م. لن يتم تغييرها.</p>
        {preview.blockers.length>0 && <div className="space-y-1" role="alert">
          {preview.blockers.map((b,i)=><p key={i} className="text-xs text-destructive flex gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0"/>{b}</p>)}
        </div>}
        {preview.blockers.length===0 && <Button type="button" className="w-full gap-2"
          disabled={applying} onClick={()=>void approve()}>
          {applying?<Loader2 className="h-4 w-4 animate-spin"/>:
            <CheckCircle2 className="h-4 w-4"/>}
          اعتماد الاتفاقية والتسوية المالية
        </Button>}
      </div>}
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      <p className="text-[11px] text-muted-foreground">
        اعتماد الاتفاقية إجراء مالي مستقل؛ التغييرات الأخرى غير المحفوظة بملف الموظف لن تدخل ضمن هذه العملية.
      </p>
    </section>
  );
}

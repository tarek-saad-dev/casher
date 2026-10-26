'use client';

import { Crown, CalendarDays } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type CompensationMode = 'global' | 'branch_monthly';
export type CompensationBranch = {
  branchId: number;
  branchCode: string;
  branchName: string;
  isAssigned: boolean;
  enabled: boolean;
  monthlySalary: number | null;
};
export type CompensationDetails = {
  employee: {
    scope: CompensationMode;
    payrollMethod: string;
    payrollEnabled: boolean;
  };
  effectiveFrom: string;
  branches: CompensationBranch[];
};

type Props = {
  createMode: boolean;
  scope: CompensationMode;
  onScopeChange: (scope: CompensationMode) => void;
  details: CompensationDetails | null;
  branches: CompensationBranch[];
  onBranchChange: (id: number, values: Partial<CompensationBranch>) => void;
  effectiveFrom: string;
  onEffectiveFromChange: (date: string) => void;
  globalSalary: string;
  onGlobalSalaryChange: (amount: string) => void;
  vipEligible: boolean;
};

export default function EmployeeBranchPayrollFields({
  createMode, scope, onScopeChange, details, branches, onBranchChange,
  effectiveFrom, onEffectiveFromChange, globalSalary, onGlobalSalaryChange, vipEligible,
}: Props) {
  const isVip = scope === 'branch_monthly';
  const returningToGlobal = !isVip && details?.employee.scope === 'branch_monthly';
  const showEffectiveDate = isVip || returningToGlobal;
  const total = branches.reduce(
    (sum, branch) => sum + (branch.enabled && branch.isAssigned ? Number(branch.monthlySalary) || 0 : 0),
    0,
  );

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label className="text-sm font-semibold">نظام القبض *</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onScopeChange('global')}
            className={scope === 'global'
              ? 'rounded-xl border border-primary bg-primary/10 p-3 text-right ring-1 ring-primary/20'
              : 'rounded-xl border border-border bg-surface-muted/20 p-3 text-right hover:border-primary/40'}
          >
            <div className="text-sm font-semibold">قبض عام</div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">اتفاقية واحدة للموظف بالطريقة المعتادة</p>
          </button>
          <button
            type="button"
            disabled={createMode}
            onClick={() => onScopeChange('branch_monthly')}
            className={scope === 'branch_monthly'
              ? 'rounded-xl border border-primary bg-primary/10 p-3 text-right ring-1 ring-primary/20'
              : 'rounded-xl border border-border bg-surface-muted/20 p-3 text-right hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-50'}
          >
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              <Crown className="h-4 w-4 text-primary" />
              قبض متعدد الفروع (VIP)
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">مرتب شهري مستقل لكل فرع، بإجمالي واضح</p>
          </button>
        </div>
        {createMode && (
          <p className="text-xs text-muted-foreground">لإضافة موظف متعدد الفروع: احفظ الموظف أولًا، ثم عيّنه على الفروع وفعّل النظام من تعديل الموظف.</p>
        )}
      </div>

      {isVip && !createMode && (
        <div className="space-y-3 rounded-xl border border-primary/25 bg-primary/5 p-3">
          {!vipEligible && <p className="text-xs text-muted-foreground">
            لو الموظف حاليًا بالساعة أو اليومية، اختار تاريخًا من الشهر الجاري لمعاينة تحويل اتفاقه مباشرة.
            الحساب هيتحول لشهري عند اعتماد التسوية، بدون حفظه مرتين.
          </p>}
          <p className="text-xs text-muted-foreground">كل فرع بيحاسب الموظف على مرتبه الخاص. الفروع غير المعين عليها الموظف لا يمكن تفعيل مرتب لها.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {branches.map((b) => (
              <div key={b.branchId} className="rounded-lg border border-border bg-background/70 p-3 space-y-2">
                <label className="flex cursor-pointer items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{b.branchName}</span>
                  <input
                    aria-label={'تفعيل مرتب ' + b.branchName}
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={b.enabled}
                    disabled={!b.isAssigned && !b.enabled}
                    onChange={(event) => onBranchChange(b.branchId, { enabled: event.target.checked })}
                  />
                </label>
                {!b.isAssigned && <p className="text-xs text-muted-foreground">عيّن الموظف على الفرع من «الفروع ومواعيد العمل» أولًا.</p>}
                <Label className="text-xs">الراتب الشهري (ج.م)</Label>
                <Input
                  aria-label={'الراتب الشهري ' + b.branchName}
                  type="number"
                  min={0}
                  step="0.01"
                  value={b.monthlySalary ?? ''}
                  dir="ltr"
                  disabled={!b.enabled || !b.isAssigned}
                  onChange={(event) => onBranchChange(b.branchId, {
                    monthlySalary: event.target.value === '' ? null : Number(event.target.value),
                  })}
                />
              </div>
            ))}
          </div>
          {branches.length === 0 && <p className="text-xs text-destructive">لا توجد فروع نشطة لهذا الموظف.</p>}
          <div className="flex items-center justify-between rounded-lg border border-border bg-surface-muted/60 p-3">
            <span className="text-sm text-muted-foreground">إجمالي المرتب الشهري</span>
            <strong className="text-base tabular-nums">{total.toLocaleString('en-US')} ج.م</strong>
          </div>
        </div>
      )}

      {returningToGlobal && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <Label>الراتب الشهري العام بعد إيقاف VIP *</Label>
          <Input
            aria-label="الراتب الشهري العام"
            type="number"
            min={0}
            step="0.01"
            dir="ltr"
            value={globalSalary}
            onChange={(event) => onGlobalSalaryChange(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">العودة للنظام العام ستكون بدايةً من التاريخ المحدد أدناه، من غير تعديل الاستحقاقات السابقة.</p>
        </div>
      )}

      {showEffectiveDate && details && (
        <div className="space-y-2">
          <Label className="flex items-center gap-2"><CalendarDays className="h-4 w-4" /> بداية سريان الاتفاقية *</Label>
          <Input
            aria-label="تاريخ سريان اتفاقية القبض"
            type="date"
            dir="ltr"
            min={isVip ? undefined : details.effectiveFrom}
            value={effectiveFrom}
            onChange={(event) => onEffectiveFromChange(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">تقدر تختار يومًا من الشهر الجاري للتسوية بأثر رجعي، أو أول يوم في شهر قادم لجدولة الاتفاقية. الفترات المقفولة تحتاج مسار تسوية خاص.</p>
        </div>
      )}
    </div>
  );
}

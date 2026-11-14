'use client';

import { useEffect, useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import type { CustomerProfileDraft, CustomerCategory, EducationLevel } from '@/lib/customerProfile';

interface ProfileOptions {
  schools: string[];
  colleges: string[];
  occupations: string[];
}

const EMPTY_OPTIONS: ProfileOptions = { schools: [], colleges: [], occupations: [] };

interface Props {
  value: CustomerProfileDraft;
  onChange: (value: CustomerProfileDraft) => void;
  errors?: Record<string, string>;
}

export default function CustomerProfileFields({ value, onChange, errors = {} }: Props) {
  const [options, setOptions] = useState<ProfileOptions>(EMPTY_OPTIONS);
  const listId = useId();

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/customers/profile-options', { signal: controller.signal })
      .then((res) => { if (!res.ok) throw new Error('failed'); return res.json(); })
      .then((data: ProfileOptions) => {
        setOptions({
          schools: Array.isArray(data.schools) ? data.schools : [],
          colleges: Array.isArray(data.colleges) ? data.colleges : [],
          occupations: Array.isArray(data.occupations) ? data.occupations : [],
        });
      })
      .catch(() => { /* Allow free entry if suggestion service is unavailable. */ });
    return () => controller.abort();
  }, []);

  const setCategory = (category: CustomerCategory) => {
    if (category === value.customerCategory) return;
    onChange({ customerCategory: category, educationLevel: null, institutionName: '', occupation: '' });
  };
  const setLevel = (level: EducationLevel) => {
    onChange({ ...value, educationLevel: level, institutionName: '' });
  };
  const list = value.educationLevel === 'school' ? options.schools : options.colleges;

  return (
    <div className="space-y-3 rounded-lg border border-border p-3" dir="rtl">
      <label className="block text-sm font-medium">العميل طالب ولا بالغ؟</label>
      <div className="grid grid-cols-2 gap-2">
        {([
          { code: 'student', label: 'طالب' },
          { code: 'adult', label: 'بالغ' },
        ] as const).map((item) => (
          <button
            key={item.code}
            type="button"
            aria-pressed={value.customerCategory === item.code}
            className={`rounded-md border px-3 py-2 text-sm transition-colors ${value.customerCategory === item.code ? 'border-primary bg-primary/10 text-primary font-semibold' : 'border-border hover:bg-accent'}`}
            onClick={() => setCategory(item.code)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {value.customerCategory && (
        <button type="button" className="text-xs text-muted-foreground underline underline-offset-2 text-right"
          onClick={() => onChange({ customerCategory: null, educationLevel: null, institutionName: '', occupation: '' })}>
          إزالة التصنيف
        </button>
      )}
      {errors.customerCategory && <p className="text-xs text-destructive">{errors.customerCategory}</p>}
      {value.customerCategory === 'student' && (
        <div className="space-y-2">
          <label htmlFor={`${listId}-stage`} className="text-sm font-medium">بيدرس فين؟</label>
          <select
            id={`${listId}-stage`}
            value={value.educationLevel ?? ''}
            onChange={(e) => setLevel(e.target.value as EducationLevel)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="" disabled>اختار المرحلة</option>
            <option value="school">مدرسة</option>
            <option value="college">كلية / جامعة</option>
          </select>
          {errors.educationLevel && <p className="text-xs text-destructive">{errors.educationLevel}</p>}
          {value.educationLevel && (
            <div className="space-y-1.5">
              <label htmlFor={`${listId}-institution`} className="text-sm font-medium">
                {value.educationLevel === 'school' ? 'اسم المدرسة' : 'اسم الكلية / الجامعة'}
              </label>
              <Input
                id={`${listId}-institution`}
                list={`${listId}-institutions`}
                placeholder="اكتب الاسم أو اختاره من القائمة"
                maxLength={150}
                value={value.institutionName}
                onChange={(e) => onChange({ ...value, institutionName: e.target.value })}
              />
              <datalist id={`${listId}-institutions`}>
                {list.map((name) => <option value={name} key={name} />)}
              </datalist>
              {errors.institutionName && <p className="text-xs text-destructive">{errors.institutionName}</p>}
            </div>
          )}
        </div>
      )}
      {value.customerCategory === 'adult' && (
        <div className="space-y-1.5">
          <label htmlFor={`${listId}-occupation`} className="text-sm font-medium">الوظيفة</label>
          <Input
            id={`${listId}-occupation`}
            list={`${listId}-occupations`}
            placeholder="اكتب الوظيفة أو اختارها من القائمة"
            maxLength={100}
            value={value.occupation}
            onChange={(e) => onChange({ ...value, occupation: e.target.value })}
          />
          <datalist id={`${listId}-occupations`}>
            {options.occupations.map((name) => <option value={name} key={name} />)}
          </datalist>
          {errors.occupation && <p className="text-xs text-destructive">{errors.occupation}</p>}
        </div>
      )}
      <p className="text-xs text-muted-foreground">أي اسم جديد هتسجله هيتضاف تلقائيًا للاختيارات في المرات الجاية.</p>
    </div>
  );
}

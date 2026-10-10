'use client';

import { useState, type ReactNode } from 'react';
import type { OnboardingIssue } from '@/platform/onboarding/wizard/types';

export const inputClass =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';

export function fieldError(issues: OnboardingIssue[], field: string): string | undefined {
  return issues.find((i) => i.severity === 'error' && i.field === field)?.message;
}

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  dir,
  hint,
  error,
  required,
  placeholder,
  min,
  step,
  autoFocus,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  dir?: 'ltr';
  hint?: string;
  error?: string;
  required?: boolean;
  placeholder?: string;
  min?: number;
  step?: number;
  autoFocus?: boolean;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-muted-foreground">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      <input
        type={type}
        dir={dir}
        min={min}
        step={step}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        className={`${inputClass} ${error ? 'border-rose-500' : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {error ? (
        <span className="block text-xs text-rose-500">{error}</span>
      ) : (
        hint && <span className="block text-xs text-muted-foreground">{hint}</span>
      )}
    </label>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  error,
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  error?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-muted-foreground">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      <select
        className={`${inputClass} ${error ? 'border-rose-500' : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {placeholder != null && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <span className="block text-xs text-rose-500">{error}</span>}
    </label>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className={`flex items-start gap-2 text-sm ${disabled ? 'opacity-70' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-1">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function Advanced({ children, label = 'إعدادات متقدمة' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-dashed border-border">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-xs text-muted-foreground"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{label}</span>
        <span aria-hidden>{open ? '−' : '+'}</span>
      </button>
      {open && <div className="grid gap-3 px-3 pb-3 sm:grid-cols-2">{children}</div>}
    </div>
  );
}

export function SmallButton({
  children,
  onClick,
  tone = 'default',
  disabled,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: 'default' | 'danger' | 'primary';
  disabled?: boolean;
  title?: string;
}) {
  const tones = {
    default: 'border-border hover:bg-muted',
    danger: 'border-rose-500/40 text-rose-500 hover:bg-rose-500/10',
    primary: 'border-primary/50 text-primary hover:bg-primary/10',
  };
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1 text-xs disabled:opacity-40 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

export function StatusBadge({ status }: { status: 'ready' | 'attention' | 'optional' }) {
  const map = {
    ready: { label: 'جاهز', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600' },
    attention: { label: 'يحتاج مراجعة', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-600' },
    optional: { label: 'اختياري', cls: 'border-border bg-muted text-muted-foreground' },
  } as const;
  const m = map[status];
  return <span className={`rounded-full border px-2 py-0.5 text-xs ${m.cls}`}>{m.label}</span>;
}

export function StepIssues({ issues }: { issues: OnboardingIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="space-y-1 rounded-lg border border-border bg-muted/40 p-3 text-xs">
      {issues.map((i, n) => (
        <li key={n} className={i.severity === 'error' ? 'text-rose-500' : 'text-amber-600'}>
          {i.message}
        </li>
      ))}
    </ul>
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

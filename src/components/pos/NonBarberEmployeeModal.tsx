'use client';

import { useMemo, useState } from 'react';
import { Check, Search, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { Barber } from '@/lib/types';

interface NonBarberEmployeeModalProps {
  open: boolean;
  onClose: () => void;
  employees: Barber[];
  selected: Barber | null;
  onSelect: (employee: Barber) => void;
  loading?: boolean;
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2);
}

export default function NonBarberEmployeeModal({
  open,
  onClose,
  employees,
  selected,
  onSelect,
  loading = false,
}: NonBarberEmployeeModalProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) =>
        e.EmpName.toLowerCase().includes(q) ||
        (e.Job ?? '').toLowerCase().includes(q),
    );
  }, [employees, query]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setQuery('');
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>اختر موظف غير حلاق</DialogTitle>
          <DialogDescription>
            مساعدين، إداريين، وباقي الموظفين — غير الحلاقين
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="بحث بالاسم أو الوظيفة..."
            className="pr-9"
            autoFocus
          />
        </div>

        <div className="max-h-[50vh] space-y-1.5 overflow-y-auto overscroll-contain pe-1">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">جاري التحميل...</p>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              لا يوجد موظفون مطابقون
            </p>
          ) : (
            filtered.map((emp) => {
              const isSelected = selected?.EmpID === emp.EmpID;
              return (
                <button
                  key={emp.EmpID}
                  type="button"
                  onClick={() => {
                    onSelect(emp);
                    setQuery('');
                    onClose();
                  }}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-right transition-colors',
                    isSelected
                      ? 'border-primary/40 bg-primary/10'
                      : 'border-border bg-surface hover:bg-surface-muted',
                  )}
                >
                  <div
                    className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-sm font-bold',
                      isSelected
                        ? 'border-primary/50 bg-primary/15 text-primary'
                        : 'border-border bg-surface-muted text-muted-foreground',
                    )}
                  >
                    {initials(emp.EmpName) || <UserRound className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'truncate text-sm font-medium',
                        isSelected ? 'text-foreground' : 'text-foreground',
                      )}
                    >
                      {emp.EmpName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {emp.Job?.trim() || 'بدون وظيفة'}
                    </p>
                  </div>
                  {isSelected && (
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary">
                      <Check className="h-3.5 w-3.5 text-primary-foreground" />
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

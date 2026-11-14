'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Search, UserPlus, X, Phone, User, Cake, FileText, AlertCircle, Pencil, Sparkles } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  formatCustomerSourceDisplay,
  isCustomerSourceMissing,
  isCustomerIncomplete,
} from '@/lib/customerSource';
import type { Customer } from '@/lib/types';
import { cn } from '@/lib/utils';

interface CustomerSearchProps {
  selected: Customer | null;
  onSelect: (customer: Customer | null) => void;
  onQuickAdd: (prefill?: string) => void;
  onCompleteData?: (customer: Customer) => void;
  onEditCustomer?: (customer: Customer) => void;
  updatedCustomer?: Customer | null;
  className?: string;
  inputClassName?: string;
}

export default function CustomerSearch({
  selected,
  onSelect,
  onQuickAdd,
  onCompleteData,
  onEditCustomer,
  updatedCustomer,
  className,
  inputClassName,
}: CustomerSearchProps) {
  const [searched, setSearched] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Patch local results cache when a customer is updated externally
  useEffect(() => {
    if (!updatedCustomer) return;
    setResults((prev) =>
      prev.map((c) => (c.ClientID === updatedCustomer.ClientID ? updatedCustomer : c))
    );
  }, [updatedCustomer]);

  const search = useCallback(async (q: string) => {
    if (q.length < 1) { setResults([]); setSearched(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/customers?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
      setSearched(true);
      setOpen(true);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, search]);

  // Close dropdown on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const formatBirthDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    return new Date(dateStr).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const effectiveSelected = useMemo(() => {
    if (!selected || !updatedCustomer) return selected;
    return selected.ClientID === updatedCustomer.ClientID ? updatedCustomer : selected;
  }, [selected, updatedCustomer]);

  const missingSource = effectiveSelected && isCustomerSourceMissing(effectiveSelected.CameFrom);
  const hasMissingData = effectiveSelected && isCustomerIncomplete(effectiveSelected);

  if (effectiveSelected) {
    return (
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">العميل</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onSelect(null)}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="flex items-start gap-2">
          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 text-primary shrink-0 mt-0.5">
            <User className="w-4 h-4" />
          </div>
          <div className="min-w-0 space-y-0.5">
            <p className="font-semibold text-sm">{effectiveSelected.Name}</p>
            {effectiveSelected.Mobile && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Phone className="w-3 h-3" /> {effectiveSelected.Mobile}
              </p>
            )}
            {effectiveSelected.BirthDate && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Cake className="w-3 h-3" /> {formatBirthDate(effectiveSelected.BirthDate)}
              </p>
            )}
            {effectiveSelected.Notes && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <FileText className="w-3 h-3" />
                <span className="truncate max-w-[200px]">{effectiveSelected.Notes}</span>
              </p>
            )}
            {effectiveSelected.CameFrom && (
              <p className="text-xs text-primary/90 flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                <span>عرفنا منين: {formatCustomerSourceDisplay(effectiveSelected.CameFrom, effectiveSelected.CameFromDetails, effectiveSelected.ReferralCode)}</span>
              </p>
            )}
          </div>
        </div>

        {/* Missing data warning - only when data is incomplete */}
        {hasMissingData && onCompleteData && (
          <button
            onClick={() => onCompleteData(effectiveSelected)}
            className="mt-2.5 w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-warning/30 bg-warning/5 text-warning text-xs font-medium hover:bg-warning/10 transition-colors"
          >
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>
              {missingSource && !effectiveSelected.BirthDate && !effectiveSelected.Address
                ? 'بيانات ناقصة — مصدر العميل غير مسجل'
                : 'بيانات ناقصة — اضغط لإتمامها'}
            </span>
            <span className="mr-auto flex gap-0.5">
              {!effectiveSelected.BirthDate && <span className="w-1.5 h-1.5 rounded-full bg-warning" />}
              {!effectiveSelected.Address   && <span className="w-1.5 h-1.5 rounded-full bg-warning" />}
              {missingSource                && <span className="w-1.5 h-1.5 rounded-full bg-warning" />}
            </span>
          </button>
        )}

        {/* Edit customer button - always visible when customer is selected */}
        {onEditCustomer && (
          <button
            onClick={() => onEditCustomer(effectiveSelected)}
            className="mt-2 w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-info/30 bg-info/5 text-info text-xs font-medium hover:bg-info/10 transition-colors"
          >
            <Pencil className="w-3.5 h-3.5 shrink-0" />
            <span>تعديل بيانات العميل</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={cn('relative min-w-0', className)} ref={dropdownRef}>
      <div className="relative">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          placeholder="بحث بالاسم أو الموبايل..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          className={cn('min-h-11 pr-10 text-sm', inputClassName)}
        />
        {loading && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {open && (
        <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {results.map((c) => (
            <button
              key={c.ClientID}
              onClick={() => { onSelect(c); setQuery(''); setOpen(false); setSearched(false); }}
              className="w-full text-right px-3 py-2.5 hover:bg-accent flex items-center gap-3 transition-colors"
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary shrink-0">
                <User className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{c.Name}</p>
                {c.Mobile && <p className="text-xs text-muted-foreground">{c.Mobile}</p>}
              </div>
            </button>
          ))}
          {searched && results.length === 0 && !loading ? (
            <button
              onClick={() => { setOpen(false); onQuickAdd(query); }}
              className="w-full text-right px-3 py-3 hover:bg-accent flex items-center gap-3 transition-colors"
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-success/10 text-success shrink-0">
                <UserPlus className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-success">تسجيل هذا العميل</p>
                <p className="text-xs text-muted-foreground truncate">«{query}» غير موجود — اضغط للتسجيل</p>
              </div>
            </button>
          ) : (
            <button
              onClick={() => { setOpen(false); onQuickAdd(); }}
              className="w-full text-right px-3 py-2.5 border-t border-border hover:bg-accent flex items-center gap-3 text-primary transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              <span className="text-sm font-medium">إضافة عميل جديد</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
